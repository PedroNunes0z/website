/**
 * URL pública do servidor de partidas (Render) e helpers de wake-up.
 *
 * O serviço no Render hiberna após inatividade no plano gratuito. Quando o
 * usuário entra na aba de games, o cliente chama `GET /api/games/wake`, que
 * por sua vez acorda o Render via `/health` com retries — sem expor a URL
 * interna nem travar a navegação.
 */

export function getGameServerUrl(): string {
  return (process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "").replace(/\/$/, "");
}

export function usePhaserEngine(): boolean {
  return process.env.NEXT_PUBLIC_USE_PHASER === "1";
}

export interface WakeResult {
  ok: boolean;
  awakened: boolean;
  reason?: string;
}

/** Acorda o Render chamando a rota proxy do Next (evita CORS e expõe timeout). */
export async function wakeGameServer(): Promise<WakeResult> {
  try {
    const response = await fetch("/api/games/wake", { cache: "no-store" });
    const data = (await response.json()) as WakeResult;
    return data;
  } catch {
    return { ok: false, awakened: false, reason: "UNREACHABLE" };
  }
}
