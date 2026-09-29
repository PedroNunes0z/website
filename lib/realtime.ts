import type { GameRoom, GameRoomPlayer } from "@/lib/games";
import type { GameInput, GameSnapshot } from "@/lib/game-engine";

/**
 * Contrato compartilhado entre servidor e cliente para os eventos de tempo real
 * publicados no Ably. Eventos são versionados (`v`) e pequenos; o servidor
 * segue sendo a fonte da verdade — os eventos são apenas notificações para
 * os clientes aplicarem/ressincronizarem o estado.
 */
export const REALTIME_VERSION = 1;

/** TTL dos tokens emitidos no servidor; o SDK do Ably renova automaticamente. */
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

/** Canal por sala, dentro do escopo permitido pela chave (`game-room:*`). */
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
}

/** Tudo que o hook de tempo real entrega ao consumidor. */
export type RealtimeClientEvent =
  | { type: "resync"; reason: "connected" | "reconnected" }
  | { type: "message"; name: string; data: RoomEventData | null };

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

/** Capacidade mínima concedida ao token de um jogador: só leitura do canal da sala. */
export function roomTokenCapability(roomId: string): string {
  return JSON.stringify({ [roomChannelName(roomId)]: ["subscribe"] });
}
