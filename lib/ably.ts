import Ably from "ably";
import { roomChannelName, type RoomEventData, type RoomEventName } from "@/lib/realtime";

let ablyRest: Ably.Rest | null | undefined;

/**
 * Cliente REST do Ably exclusivo do servidor. A chave só sai do processo
 * pelas chamadas feitas aqui (emissão de token requests e publicação de
 * eventos); nunca é enviada ao navegador.
 */
export function getAblyRest(): Ably.Rest | null {
  if (ablyRest !== undefined) return ablyRest;
  const key = process.env.ABLY_API_KEY?.trim();
  ablyRest = key ? new Ably.Rest({ key }) : null;
  return ablyRest;
}

export function hasRealtime() {
  return getAblyRest() !== null;
}

/**
 * Publica um evento versionado no canal da sala. Nunca lança exceção: uma
 * falha do Ably não pode derrubar o fluxo do jogo (o cliente cai para o
 * fallback HTTP e se ressincroniza).
 */
export async function publishRoomEvent(roomId: string, name: RoomEventName, data: RoomEventData): Promise<void> {
  const ably = getAblyRest();
  if (!ably) return;
  try {
    await ably.channels.get(roomChannelName(roomId)).publish(name, data);
  } catch (error) {
    console.warn(`Ably: falha ao publicar ${name} em game-room:${roomId}:`, error);
  }
}
