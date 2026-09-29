import { NextRequest, NextResponse } from "next/server";
import { getGameRoom, heartbeatGameRoom, joinGameRoom, leaveGameRoom, startGameRoom, gameFromString, isValidPlayerName, type GameTeam } from "@/lib/games";
import { publishRoomEvent } from "@/lib/ably";
import { REALTIME_VERSION } from "@/lib/realtime";
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
      const { room, player } = await joinGameRoom(game, id, body.playerId, body.name.trim(), team);
      await publishRoomEvent(id, "player-joined", { v: REALTIME_VERSION, player, room });
      return NextResponse.json({ room, player });
    }
    if (body.action === "heartbeat") {
      if (typeof body.playerId !== "string") return NextResponse.json({ error: "Jogador inválido." }, { status: 400 });
      return NextResponse.json(await heartbeatGameRoom(game, id, body.playerId));
    }
    if (body.action === "start") {
      if (typeof body.playerId !== "string" || typeof body.ownerToken !== "string" || body.ownerToken.length > 64) return NextResponse.json({ error: "Dono da sala inválido." }, { status: 400 });
      const { room } = await startGameRoom(game, id, body.playerId, body.ownerToken);
      await publishRoomEvent(id, "game-state-updated", { v: REALTIME_VERSION, room });
      return NextResponse.json({ room });
    }
    if (body.action === "leave") {
      if (typeof body.playerId !== "string") return NextResponse.json({ error: "Jogador inválido." }, { status: 400 });
      const roomBefore = await getGameRoom(game, id).catch(() => null);
      const wasOwner = roomBefore?.ownerId === body.playerId;
      await leaveGameRoom(game, id, body.playerId, typeof body.ownerToken === "string" ? body.ownerToken : "");
      const roomAfter = await getGameRoom(game, id).catch(() => null);
      if (wasOwner || !roomAfter) await publishRoomEvent(id, "game-ended", { v: REALTIME_VERSION, reason: "room-closed" });
      else await publishRoomEvent(id, "player-left", { v: REALTIME_VERSION, playerId: body.playerId, room: roomAfter });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "As salas online precisam de Redis configurado." }, { status: 503 });
    }
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "A sala expirou ou não existe." }, { status: 404 });
    if (error instanceof Error && error.message === "FULL") return NextResponse.json({ error: "A sala está cheia." }, { status: 409 });
    if (error instanceof Error && error.message === "NEED_TEAMS") return NextResponse.json({ error: "É preciso ter ao menos um jogador em cada equipe." }, { status: 409 });
    if (error instanceof Error && error.message === "NOT_OWNER") return NextResponse.json({ error: "Apenas o dono pode iniciar ou encerrar a sala." }, { status: 403 });
    console.error("Game room update failed:", error);
    return NextResponse.json({ error: "Não foi possível atualizar a sala." }, { status: 500 });
  }
}
