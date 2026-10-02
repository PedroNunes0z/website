import { NextRequest, NextResponse, after } from "next/server";
import { acceptGameInput, acceptGameSnapshot, gameFromString, getGameRoomState } from "@/lib/games";
import { publishRoomEvent } from "@/lib/ably";
import { REALTIME_VERSION } from "@/lib/realtime";
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
    && typeof input.kickSpin === "boolean"
    && typeof input.charging === "boolean"
    && typeof input.kickSeq === "number" && Number.isSafeInteger(input.kickSeq) && input.kickSeq >= 0
    && typeof input.dashSeq === "number" && Number.isSafeInteger(input.dashSeq) && input.dashSeq >= 0
    && typeof input.aimX === "number" && Number.isFinite(input.aimX) && Math.abs(input.aimX) <= 1000
    && typeof input.aimY === "number" && Number.isFinite(input.aimY) && Math.abs(input.aimY) <= 1000
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
    // Instante de chegada: viaja dentro do evento para que o cliente meça a
    // entrega (servidor → Ably → navegador) separada da latência da escrita.
    const sentAt = Date.now();
    const raw = await request.text();
    if (raw.length > 12_000) return NextResponse.json({ error: "Dados grandes demais." }, { status: 413 });
    const body = JSON.parse(raw);
    const game = gameFromString(body.game ?? "");
    if (!game || typeof body.playerId !== "string" || body.playerId.length > 64) return NextResponse.json({ error: "Jogador inválido." }, { status: 400 });
    const normalizedInput = body.input && typeof body.input === "object"
      ? { ...body.input, kickSpin: body.input.kickSpin === true, charging: body.input.charging === true, dashSeq: Number.isSafeInteger(body.input.dashSeq) ? body.input.dashSeq : 0 }
      : body.input;
    if (body.action === "input" && validInput(normalizedInput)) {
      const persist = await acceptGameInput(game, id, body.playerId, normalizedInput);
      // `notify: false`: cliente com tempo real ativo publicando direto no
      // canal — o POST serve só para persistir o input no Redis (resync e
      // fallback). Sem o publish aqui, o destinatário não receberia de volta
      // uma versão defasada do mesmo input ~300 ms depois (regressão de
      // movimento).
      const notify = body.notify !== false;
      // `after`: a resposta não espera nem o Redis nem o Ably (que nunca podem
      // segurar a escrita), mas o runtime mantém a função viva até gravar e
      // publicar. Persistência e notificação correm em paralelo — a escrita no
      // Redis não pode adicionar sua latência à entrega do evento.
      after(async () => {
        await Promise.all([
          persist(),
          notify ? publishRoomEvent(id, "game-input-updated", { v: REALTIME_VERSION, playerId: body.playerId, input: normalizedInput, sentAt }) : Promise.resolve(),
        ]);
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "snapshot" && validSnapshot(body.snapshot, game)) {
      if (typeof body.ownerToken !== "string" || body.ownerToken.length > 64) return NextResponse.json({ error: "Dono da sala inválido." }, { status: 403 });
      const persist = await acceptGameSnapshot(game, id, body.playerId, body.ownerToken, body.snapshot);
      const notify = body.notify !== false;
      after(async () => {
        await Promise.all([
          persist(),
          notify ? publishRoomEvent(id, "game-snapshot-updated", { v: REALTIME_VERSION, playerId: body.playerId, snapshot: body.snapshot, sentAt }) : Promise.resolve(),
        ]);
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
