import type { GameInput, GameSnapshot } from "@/lib/game-engine";
import { getGameServerUrl } from "@/lib/game-server";

export type GeckosStatus = "idle" | "connecting" | "connected" | "disconnected" | "unavailable";

interface GeckosChannelLike {
  on(event: string, callback: (data?: unknown) => void): void;
  emit(event: string, data?: unknown): void;
  close(): void;
  id?: string;
}

/**
 * Transporte UDP via geckos.io (@geckos.io/client) para inputs/snapshots.
 *
 * Modelo host-autoritativo (igual ao atual via HTTP/Ably):
 * - todo jogador emite `input` a ~60 Hz;
 * - o host emite `snapshot` a ~20 Hz;
 * - o servidor apenas retransmite para a sala e persiste o snapshot no Redis.
 *
 * Quando `NEXT_PUBLIC_GAME_SERVER_URL` não está configurada (ou o Render
 * ainda está acordando), `connect()` resolve `null` e o chamador mantém o
 * fluxo atual (Ably + polling HTTP) sem quebrar.
 */
export class GeckosRoomTransport {
  private channel: GeckosChannelLike | null = null;
  status: GeckosStatus = "idle";

  static available(): boolean {
    return getGameServerUrl().length > 0;
  }

  async connect(roomId: string, playerId: string): Promise<GeckosChannelLike | null> {
    const url = getGameServerUrl();
    if (!url) {
      this.status = "unavailable";
      return null;
    }
    this.status = "connecting";
    try {
      const { default: geckos } = await import("@geckos.io/client");
      const channel = (await geckos({ url })) as unknown as GeckosChannelLike;
      channel.emit("join", { roomId, playerId });
      this.channel = channel;
      this.status = "connected";
      return channel;
    } catch {
      this.status = "unavailable";
      return null;
    }
  }

  onSnapshot(callback: (snapshot: GameSnapshot) => void): void {
    this.channel?.on("snapshot", (data) => {
      const snapshot = (data as { snapshot?: GameSnapshot })?.snapshot;
      if (snapshot && typeof snapshot.revision === "number") callback(snapshot);
    });
  }

  onInput(callback: (playerId: string, input: GameInput) => void): void {
    this.channel?.on("input", (data) => {
      const payload = data as { playerId?: string; input?: GameInput };
      if (payload?.playerId && payload?.input) callback(payload.playerId, payload.input);
    });
  }

  sendInput(playerId: string, input: GameInput): void {
    if (this.status !== "connected") return;
    try {
      this.channel?.emit("input", { playerId, input });
    } catch {
      // UDP é fire-and-forget: o próximo tick corrige.
    }
  }

  sendSnapshot(snapshot: GameSnapshot): void {
    if (this.status !== "connected") return;
    try {
      this.channel?.emit("snapshot", { snapshot });
    } catch {
      // idem — o snapshot seguinte corrige.
    }
  }

  close(): void {
    try {
      this.channel?.close();
    } catch {
      // ignore
    }
    this.channel = null;
    this.status = "idle";
  }
}
