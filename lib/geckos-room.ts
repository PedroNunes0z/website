import type { GameInput, GameSnapshot } from "@/lib/game-engine";
import { getGameServerUrl } from "@/lib/game-server";

export type GeckosStatus = "idle" | "connecting" | "connected" | "disconnected" | "unavailable";

/** Chave do endereço LAN salvo pelo jogador no painel online. */
export const LAN_URL_KEY = "pedro-games-lan-url";

interface GeckosChannelLike {
  on(event: string, callback: (data?: unknown) => void): void;
  emit(event: string, data?: unknown): void;
  close(): void;
  id?: string;
}

function readLanUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(LAN_URL_KEY) ?? "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * Transporte UDP via geckos.io (@geckos.io/client) para inputs/snapshots.
 *
 * Modelo host-autoritativo:
 * - todo jogador emite `input` ao mudar;
 * - o host emite `snapshot` a ~10 Hz;
 * - o servidor apenas retransmite para a sala e espelha no Redis.
 *
 * Origem do servidor, nesta ordem: endereço LAN salvo pelo jogador, URL do
 * Render (`NEXT_PUBLIC_GAME_SERVER_URL`). Sem nenhuma das duas, `connect()`
 * resolve `null` e o jogo segue só no HTTP, sem quebrar.
 */
export class GeckosRoomTransport {
  private channel: GeckosChannelLike | null = null;
  status: GeckosStatus = "idle";
  lan = false;

  static serverUrl(): string {
    return readLanUrl() || getGameServerUrl();
  }

  static available(): boolean {
    return GeckosRoomTransport.serverUrl().length > 0;
  }

  static isLan(): boolean {
    return readLanUrl().length > 0;
  }

  async connect(roomId: string, playerId: string): Promise<GeckosChannelLike | null> {
    const url = GeckosRoomTransport.serverUrl();
    if (!url) {
      this.status = "unavailable";
      return null;
    }
    this.lan = readLanUrl().length > 0;
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
      // UDP é fire-and-forget: a próxima mudança corrige.
    }
  }

  sendSnapshot(snapshot: GameSnapshot): void {
    if (this.status !== "connected") return;
    try {
      this.channel?.emit("snapshot", { snapshot });
    } catch {
      // idem: o snapshot seguinte corrige.
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
