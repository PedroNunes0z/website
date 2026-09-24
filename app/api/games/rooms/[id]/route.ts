import { NextRequest, NextResponse } from "next/server";
import { heartbeatGameRoom, joinGameRoom, leaveGameRoom, gameFromString, isValidPlayerName, type GameTeam } from "@/lib/games";
import { isSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const { id } = await context.params;
  if (!/^[A-Z0-9]{8}$/.test(id)) return NextResponse.json({ error: "Sala inválida." }, { status: 400 });

  try {
    const body = await request.json();
    const game = gameFromString(body.game ?? "");
    if (!game) return NextResponse.json({ error: "Jogo inválido." }, { status: 400 });
    if (body.action === "join") {
      if (!isValidPlayerName(body.name) || typeof body.playerId !== "string" || body.playerId.length > 64) {
        return NextResponse.json({ error: "Informe nome e jogador válidos." }, { status: 400 });
      }
      const team: GameTeam = body.team === "orange" ? "orange" : "blue";
      return NextResponse.json(await joinGameRoom(game, id, body.playerId, body.name.trim(), team));
    }
    if (body.action === "heartbeat") {
      if (typeof body.playerId !== "string") return NextResponse.json({ error: "Jogador inválido." }, { status: 400 });
      return NextResponse.json(await heartbeatGameRoom(game, id, body.playerId));
    }
    if (body.action === "leave") {
      if (typeof body.playerId !== "string") return NextResponse.json({ error: "Jogador inválido." }, { status: 400 });
      await leaveGameRoom(game, id, body.playerId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "As salas online precisam de Redis configurado." }, { status: 503 });
    }
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "A sala expirou ou não existe." }, { status: 404 });
    if (error instanceof Error && error.message === "FULL") return NextResponse.json({ error: "A sala está cheia." }, { status: 409 });
    console.error("Game room update failed:", error);
    return NextResponse.json({ error: "Não foi possível atualizar a sala." }, { status: 500 });
  }
}
