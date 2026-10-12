import { NextResponse } from "next/server";

/**
 * Proxy de wake-up do servidor de partidas (Render).
 *
 * O plano gratuito do Render hiberna o serviço UDP após inatividade e a
 * primeira resposta pode levar ~30 a 60 s. Esta rota acorda o serviço com
 * retries e timeout folgado sem expor a URL interna ao navegador além do
 * necessário e sem travar a aba de games.
 */
export async function GET() {
  const url = (process.env.GAME_SERVER_URL ?? process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "").replace(/\/$/, "");
  if (!url) {
    return NextResponse.json({ ok: false, awakened: false, reason: "NOT_CONFIGURED" });
  }
  const target = `${url}/health`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const response = await fetch(target, { cache: "no-store", signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) return NextResponse.json({ ok: true, awakened: true });
    } catch {
      // tenta de novo: o Render pode estar acordando
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  return NextResponse.json({ ok: false, awakened: false, reason: "WAKING" });
}
