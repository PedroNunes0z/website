import type { GameRoom, GameRoomPlayer } from "@/lib/games";
import type { GameInput, GameSnapshot } from "@/lib/game-engine";

/**
 * Contrato compartilhado entre servidor e cliente para os eventos de tempo real
 * publicados no Ably. Eventos são versionados (`v`) e pequenos; o servidor
 * segue sendo a fonte da verdade para o estado persistente da sala.
 *
 * Dois publicadores convivem no mesmo canal:
 * - Servidor (REST, sem clientId): eventos de sala — entrada/saída de jogador,
 *   início e fim de partida — além de inputs/snapshots quando um cliente opera
 *   no modo compatibilidade HTTP.
 * - Clientes (Realtime, token com `publish`): os dados quentes da partida
 *   (inputs de cada jogador e snapshots do host) vão direto pelo websocket do
 *   Ably, sem atravessar POST HTTP → Redis → Ably a cada transmissão — esse
 *   caminho custava ~300–400 ms por evento em serverless e era a origem do
 *   lag sentido por quem entra na sala.
 *
 * Confiança na recepção: o Ably atribui à mensagem o `clientId` do token do
 * publicador (impossível forjar, pois o token é emitido com clientId fixo).
 * Clientes só aceitam `game-snapshot-updated` publicado pelo dono da sala e
 * eventos de sala vindos do servidor (`clientId` ausente); inputs valem pela
 * identidade atribuída pelo canal.
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
  /**
   * Momento em que o servidor recebeu a escrita que gerou este evento. O
   * cliente mede `Date.now() - sentAt` para separar a latência do caminho
   * servidor→Ably→cliente da latência da escrita HTTP do próprio cliente.
   */
  sentAt?: number;
}

/** Tudo que o hook de tempo real entrega ao consumidor. */
export type RealtimeClientEvent =
  | { type: "resync"; reason: "connected" | "reconnected" }
  | {
      type: "message";
      name: string;
      data: RoomEventData | null;
      /**
       * `clientId` atribuído pelo Ably ao publicador (o token é amarrado ao
       * playerId, então não é forjável). `null` quando o evento veio do
       * servidor via API REST — tratado como confiável.
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
 * Capacidade do token de um jogador: leitura e publicação no canal da sala.
 * O publish é o que permite ao convidado enviar inputs direto pelo websocket
 * (e ao host publicar snapshots), cortando o servidor do caminho quente. A
 * identidade do publicador é garantida pelo `clientId` fixado no token, e os
 * consumidores ignoram eventos de sala publicados por clientes.
 */
export function roomTokenCapability(roomId: string): string {
  return JSON.stringify({ [roomChannelName(roomId)]: ["subscribe", "publish"] });
}
