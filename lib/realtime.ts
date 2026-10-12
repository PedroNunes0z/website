import type { GameRoom, GameRoomPlayer } from "@/lib/games";
import type { GameInput, GameSnapshot } from "@/lib/game-engine";

/**
 * Contrato de versão dos envelopes de tempo real (UDP e sondagem HTTP).
 * Eventos são pequenos e versionados em `v`; o servidor segue sendo a fonte
 * da verdade para o estado persistente da sala.
 *
 * Dois caminhos convivem:
 * - UDP (geckos.io, com ou sem servidor Render/LAN): inputs de cada jogador
 *   e snapshots do host viajam direto, sem atravessar POST HTTP a cada
 *   transmissão. Esse era o caminho de ~300 a 400 ms por evento em serverless
 *   e a origem do lag de quem entra na sala.
 * - HTTP (sondagem): leitura periódica do estado autoritativo no Redis para
 *   quem está sem UDP, além de persistência de todas as escritas.
 */
export const REALTIME_VERSION = 1;

/** Janela de presença das salas e dos transportes locais. */
export const realtimeTokenTtlMs = 15 * 60 * 1000;

export type RoomEventName =
  | "game-state-updated"
  | "player-joined"
  | "player-left"
  | "game-ended"
  | "game-snapshot-updated"
  | "game-input-updated";

export const ROOM_EVENT_NAMES: readonly RoomEventName[] = [
  "game-state-updated",
  "player-joined",
  "player-left",
  "game-ended",
  "game-snapshot-updated",
  "game-input-updated",
];

/** Canal por sala no transporte UDP (`game-room:<id>`). */
export function roomChannelName(roomId: string): string {
  return `game-room:${roomId}`;
}

export interface RoomEventData {
  v: number;
  room?: GameRoom;
  player?: GameRoomPlayer;
  playerId?: string;
  reason?: string;
  snapshot?: GameSnapshot;
  input?: GameInput;
  /**
   * Momento em que o servidor recebeu a escrita que gerou este evento. O
   * cliente mede `Date.now() - sentAt` para separar a latência de entrega
   * da latência da escrita HTTP do próprio cliente.
   */
  sentAt?: number;
}

/** Tudo que o transporte em tempo real entrega ao consumidor. */
export type RealtimeClientEvent =
  | { type: "resync"; reason: "connected" | "reconnected" }
  | {
      type: "message";
      name: string;
      data: RoomEventData | null;
      /**
       * Identidade do publicador quando o transporte a garante (UDP com
       * sala). `null` indica evento vindo do servidor pela API REST,
       * tratado como confiável por definição.
       */
      fromClientId: string | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Garante que o payload recebido segue a versão e o formato do contrato.
 * Payloads desconhecidos devem ser ignorados e tratados com ressincronização.
 */
export function isVersionedEvent(data: unknown): data is RoomEventData {
  return isRecord(data) && data.v === REALTIME_VERSION;
}

/**
 * Escopo do canal de uma sala no transporte UDP. Mantido para documentar o
 * contrato e para os testes de tempo real.
 */
export function roomTokenCapability(roomId: string): string {
  return JSON.stringify({ [roomChannelName(roomId)]: ["subscribe", "publish"] });
}
