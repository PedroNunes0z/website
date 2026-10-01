import { getRedis } from "@/lib/redis";
import type { GameId } from "@/lib/games";
import { getGameRoomState, heartbeatGameRoom, publishGameSnapshot } from "@/lib/games";
import { stepGame, reconcileAuthoritativeState } from "@/lib/game-engine";
import type { GameInput, GameSnapshot } from "@/lib/game-engine";

interface SyncRequest {
  game: GameId;
  roomId: string;
  playerId: string;
  input: GameInput;
}

interface SyncResponse {
  snapshot: GameSnapshot;
  timestamp: number;
}

// Última snapshot conhecida por sala (em memória durante o ciclo de simulação)
const ROOM_SIMULATIONS = new Map<string, { snapshot: GameSnapshot; lastKicks: Record<string, number>; lastStep: number }>();

// Limpa simulações antigas
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of ROOM_SIMULATIONS.entries()) {
    if (now - value.lastStep > 65000) {
      ROOM_SIMULATIONS.delete(key);
    }
  }
}, 60000);

export async function POST(req: Request) {
  try {
    const { game, roomId, playerId, input } = (await req.json()) as SyncRequest;

    // Validar entrada
    if (!game || !roomId || !playerId || !input) {
      return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) {
      return Response.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
    }

    // Heartbeat: confirma que o jogador está vivo
    await heartbeatGameRoom(game, roomId, playerId);

    // Buscar estado da sala e última snapshot
    const { room, snapshot: serverSnapshot } = await getGameRoomState(game, roomId);
    if (room.status !== "playing") {
      return Response.json({ error: "NOT_PLAYING" }, { status: 400 });
    }

    const now = Date.now();
    const roomKey = `${roomId}:${game}`;
    let simulation = ROOM_SIMULATIONS.get(roomKey);

    // Inicializar simulação se não existir
    if (!simulation) {
      simulation = {
        snapshot: serverSnapshot || { game, players: [], ball: { x: 0, y: 0, vx: 0, vy: 0 }, score: { blue: 0, orange: 0 }, elapsed: 0, freeze: 0, winner: null, revision: 0 },
        lastKicks: {},
        lastStep: now,
      };
      ROOM_SIMULATIONS.set(roomKey, simulation);
    }

    // Calcular delta desde o último step
    const dt = Math.min((now - simulation.lastStep) / 1000, 0.05);
    simulation.lastStep = now;

    // Coletar inputs de todos os jogadores
    const playerInputs = await (async () => {
      const redis = getRedis();
      if (!redis) return {};
      const inputMap = await redis.hgetall<Record<string, string>>(
        `portfolio:games:room:${roomId}:inputs`
      );
      if (!inputMap) return {};

      const result: Record<string, GameInput> = {};
      for (const [id, json] of Object.entries(inputMap)) {
        try {
          result[id] = JSON.parse(json as string);
        } catch {
          // Ignorar inputs malformados
        }
      }
      return result;
    })();

    // Aplicar input do jogador atual (garante que chegue imediatamente)
    playerInputs[playerId] = input;

    // Executar um passo da física
    stepGame(simulation.snapshot, playerInputs, simulation.lastKicks, dt, {
      authoritative: true, // Host é autoritário
    });

    // Salvar snapshot no Redis para outros clientes lerem
    await publishGameSnapshot(game, roomId, room.ownerId, "", simulation.snapshot);

    const response: SyncResponse = {
      snapshot: simulation.snapshot,
      timestamp: now,
    };

    return Response.json(response);
  } catch (error) {
    console.error("[SYNC] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
      { status: 500 }
    );
  }
}
