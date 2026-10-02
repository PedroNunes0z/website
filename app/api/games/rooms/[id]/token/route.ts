import { NextRequest, NextResponse } from "next/server";
import { getAblyRest } from "@/lib/ably";
import { gameFromString, getGameRoom } from "@/lib/games";
import { realtimeTokenTtlMs, roomTokenCapability } from "@/lib/realtime";
import { isSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Emite um token request assinado no servidor para o canal da sala.
 * A `ABLY_API_KEY` nunca chega ao navegador; o token é restrito a
 * subscribe+publish no canal `game-room:<roomId>` do jogador, com o
 * `clientId` fixado ao playerId — o publish permite que inputs e snapshots
 * fluam direto pelo websocket, e o clientId fixo impede que um jogador
 * publique se passando por outro.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const { id } = await context.params;
  if (!/^[A-Z0-9]{8}$/.test(id)) return NextResponse.json({ error: "Sala inválida." }, { status: 400 });

  const ably = getAblyRest();
  if (!ably) return NextResponse.json({ error: "Tempo real não configurado." }, { status: 503 });

  try {
    const body = await request.json();
    const game = gameFromString(body.game ?? "");
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    if (!game || !playerId || playerId.length > 64) {
      return NextResponse.json({ error: "Informe jogo e jogador válidos." }, { status: 400 });
    }
    const room = await getGameRoom(game, id);
    if (!room.players.some((player) => player.id === playerId)) {
      return NextResponse.json({ error: "O jogador não está nesta sala." }, { status: 403 });
    }
    const tokenRequest = await ably.auth.createTokenRequest({
      clientId: playerId,
      capability: roomTokenCapability(id),
      ttl: realtimeTokenTtlMs,
    });
    return NextResponse.json(tokenRequest, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "As salas online precisam de Redis configurado." }, { status: 503 });
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "A sala expirou ou não existe." }, { status: 404 });
    }
    console.error("Ably token request failed:", error);
    return NextResponse.json({ error: "Não foi possível emitir o token de tempo real." }, { status: 500 });
  }
}
