import "dotenv/config";
import express from "express";
import cors from "cors";
import { Redis } from "ioredis";
import geckos from "@geckos.io/server";

/**
 * Servidor de partidas: salas no Redis (TCP) + retransmissão UDP via geckos.io.
 *
 * Modelo host-autoritativo, igual ao do Next:
 * - HTTP (Express) gerencia salas e persiste snapshots/inputs no Redis;
 * - UDP (geckos.io) retransmite `input` (~60 Hz) e `snapshot` (~20 Hz) dentro
 *   da sala com latência baixa; o servidor também espelha o último snapshot
 *   no Redis para ressincronização de quem entra no meio da partida.
 *
 * Fase 2 (planejada): simulação autoritativa no servidor reaproveitando
 * `lib/game-engine` (step fixo a 60 Hz) em vez de relay do host.
 */

const PORT = Number(process.env.PORT ?? 9208);
const REDIS_URL = process.env.REDIS_URL ?? "";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const ROOM_TTL = 60;

const redis = REDIS_URL ? new Redis(REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
if (!redis) console.warn("[games-udp] REDIS_URL ausente: salas ficam só em memória.");

const memory = new Map();

const roomKey = (id) => `games:room:${id}`;
const snapshotKey = (id) => `games:room:${id}:snapshot`;
const inputsKey = (id) => `games:room:${id}:inputs`;
const indexKey = (game) => `games:index:${game}`;

async function writeRoom(room) {
  if (!redis) {
    memory.set(room.id, { room, snapshot: memory.get(room.id)?.snapshot ?? null, inputs: {} });
    return;
  }
  await redis.set(roomKey(room.id), JSON.stringify(room), "EX", ROOM_TTL);
  await redis.zadd(indexKey(room.game), Date.now(), room.id);
}

async function readRoom(id) {
  if (!redis) return memory.get(id)?.room ?? null;
  const raw = await redis.get(roomKey(id));
  return raw ? JSON.parse(raw) : null;
}

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "portfolio-games-udp", time: Date.now() });
});

app.get("/rooms", async (req, res) => {
  try {
    const game = String(req.query.game ?? "");
    if (game !== "haxball" && game !== "hoquei") return res.status(400).json({ error: "INVALID_GAME" });
    if (!redis) {
      const rooms = [...memory.values()].map((m) => m.room).filter((r) => r.game === game).slice(0, 30);
      return res.json({ rooms });
    }
    const ids = await redis.zrevrange(indexKey(game), 0, 29);
    const rooms = [];
    for (const id of ids) {
      const raw = await redis.get(roomKey(id));
      if (raw) {
        const room = JSON.parse(raw);
        if (room.game === game) rooms.push(room);
      }
    }
    res.json({ rooms });
  } catch (error) {
    console.error("[games-udp] list rooms:", error);
    res.status(500).json({ error: "INTERNAL" });
  }
});

app.get("/rooms/:id/state", async (req, res) => {
  try {
    const room = await readRoom(String(req.params.id ?? "").toUpperCase());
    if (!room) return res.status(404).json({ error: "NOT_FOUND" });
    if (!redis) {
      const stored = memory.get(room.id);
      return res.json({ room, snapshot: stored?.snapshot ?? null, inputs: stored?.inputs ?? {} });
    }
    const [snapshotRaw, inputsRaw] = await Promise.all([
      redis.get(snapshotKey(room.id)),
      redis.hgetall(inputsKey(room.id)),
    ]);
    const inputs = {};
    for (const [playerId, raw] of Object.entries(inputsRaw ?? {})) {
      try {
        inputs[playerId] = JSON.parse(raw);
      } catch {
        // input corrompido: ignora, o próximo tick corrige
      }
    }
    res.json({ room, snapshot: snapshotRaw ? JSON.parse(snapshotRaw) : null, inputs });
  } catch (error) {
    console.error("[games-udp] room state:", error);
    res.status(500).json({ error: "INTERNAL" });
  }
});

app.post("/rooms", async (req, res) => {  try {
    const { game, name } = req.body ?? {};
    if ((game !== "haxball" && game !== "hoquei") || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "INVALID_BODY" });
    }
    const now = Date.now();
    const id = Math.random().toString(36).slice(2, 10).toUpperCase();
    const playerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const room = {
      id, game, ownerId: playerId, createdAt: now, status: "waiting",
      players: [{ id: playerId, name: name.trim().slice(0, 20), team: "blue", joinedAt: now, lastSeen: now }],
    };
    await writeRoom(room);
    res.json({ room, playerId });
  } catch (error) {
    console.error("[games-udp] create room:", error);
    res.status(500).json({ error: "INTERNAL" });
  }
});

// UDP relay por sala.
const io = geckos();
const members = new Map(); // roomId -> Set<channel>

io.onConnection((channel) => {
  channel.on("join", (data) => {
    const { roomId } = data ?? {};
    if (typeof roomId !== "string") return;
    channel.join(roomId);
    if (!members.has(roomId)) members.set(roomId, new Set());
    members.get(roomId).add(channel);
    channel.roomId = roomId;
  });

  channel.on("input", (data) => {
    const roomId = channel.roomId;
    if (!roomId || !data?.playerId || !data?.input) return;
    channel.broadcast.emit("input", data, { room: roomId });
    if (redis) {
      redis.hset(inputsKey(roomId), { [data.playerId]: JSON.stringify(data.input) }).catch(() => undefined);
      redis.expire(inputsKey(roomId), ROOM_TTL).catch(() => undefined);
    }
  });

  channel.on("snapshot", async (data) => {
    const roomId = channel.roomId;
    if (!roomId || !data?.snapshot) return;
    channel.broadcast.emit("snapshot", data, { room: roomId });
    try {
      if (redis) await redis.set(snapshotKey(roomId), JSON.stringify(data.snapshot), "EX", ROOM_TTL);
      else if (memory.has(roomId)) memory.get(roomId).snapshot = data.snapshot;
    } catch {
      // relay já entregue; persistência é best-effort
    }
  });

  channel.onDisconnect(() => {
    const roomId = channel.roomId;
    if (roomId && members.has(roomId)) {
      members.get(roomId).delete(channel);
      if (members.get(roomId).size === 0) members.delete(roomId);
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`[games-udp] HTTP :${PORT} + geckos.io prontos.`);
});

io.addServer(server);
