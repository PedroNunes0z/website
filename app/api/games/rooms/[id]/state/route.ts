import { NextRequest, NextResponse } from "next/server";
import { gameFromString, getGameRoomState, publishGameInput, publishGameSnapshot } from "@/lib/games";
import { isSameOrigin } from "@/lib/request-security";
import type { GameInput, GameSnapshot } from "@/lib/game-engine";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") return NextResponse.json({ error: "Redis não configurado." }, { status: 503 });
  if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Sala indisponível." }, { status: 404 });
  if (error instanceof Error && error.message === "NOT_HOST") return NextResponse.json({ error: "Apenas o criador pode atualizar a partida." }, { status: 403 });
  return NextResponse.json({ error: "Não foi possível atualizar a partida." }, { status: 500 });
}

function validInput(value: unknown): value is GameInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.x === "number" && Math.abs(input.x) <= 1
    && typeof input.y === "number" && Math.abs(input.y) <= 1
    && typeof input.sprint === "boolean"
    && typeof input.spin === "boolean"
    && typeof input.kickSeq === "number" && Number.isSafeInteger(input.kickSeq) && input.kickSeq >= 0
    && typeof input.aimX === "number" && Number.isFinite(input.aimX) && Math.abs(input.aimX) <= 500
    && typeof input.aimY === "number" && Number.isFinite(input.aimY) && Math.abs(input.aimY) <= 280
    && typeof input.power === "number" && input.power >= 0 && input.power <= 1;
}

function validSnapshot(value: unknown, game: string): value is GameSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.game !== game || !Array.isArray(snapshot.players) || snapshot.players.length > 10 || !snapshot.ball || typeof snapshot.ball !== "object") return false;
  const ball = snapshot.ball as Record<string, unknown>;
  return [ball.x, ball.y, ball.vx, ball.vy].every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) < 5000)
    && snapshot.players.every((player) => {
      if (!player || typeof player !== "object") return false;
      const actor = player as Record<string, unknown>;
      return typeof actor.id === "string" && actor.id.length <= 64
        && typeof actor.name === "string" && actor.name.length <= 20
        && (actor.team === "blue" || actor.team === "orange")
        && [actor.x, actor.y, actor.vx, actor.vy].every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) < 5000);
    });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const game = gameFromString(request.nextUrl.searchParams.get("game") ?? "");
  if (!/^[A-Z0-9]{8}$/.test(id) || !game) return NextResponse.json({ error: "Sala inválida." }, { status: 400 });
  try {
    return NextResponse.json(await getGameRoomState(game, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const { id } = await context.params;
  if (!/^[A-Z0-9]{8}$/.test(id)) return NextResponse.json({ error: "Sala inválida." }, { status: 400 });
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return NextResponse.json({ error: "Dados grandes demais." }, { status: 413 });
    const body = JSON.parse(raw);
    const game = gameFromString(body.game ?? "");
    if (!game || typeof body.playerId !== "string" || body.playerId.length > 64) return NextResponse.json({ error: "Jogador inválido." }, { status: 400 });
    if (body.action === "input" && validInput(body.input)) {
      await publishGameInput(game, id, body.playerId, body.input);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "snapshot" && validSnapshot(body.snapshot, game)) {
      await publishGameSnapshot(game, id, body.playerId, body.snapshot);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
