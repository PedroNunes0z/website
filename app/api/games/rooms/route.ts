import { NextRequest, NextResponse } from "next/server";
import { createGameRoom, gameFromString, isValidPlayerName, listGameRooms } from "@/lib/games";
import { isSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const game = gameFromString(request.nextUrl.searchParams.get("game") ?? "");
  if (!game) return NextResponse.json({ error: "Jogo inválido." }, { status: 400 });
  try {
    return NextResponse.json({ rooms: await listGameRooms(game) });
  } catch (error) {
    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "As salas online precisam de Redis configurado." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível listar as salas." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  try {
    const body = await request.json();
    const game = gameFromString(body.game ?? "");
    if (!game || !isValidPlayerName(body.name)) return NextResponse.json({ error: "Informe jogo e nome válidos." }, { status: 400 });
    return NextResponse.json(await createGameRoom(game, body.name.trim()), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "As salas online precisam de Redis configurado." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível criar a sala." }, { status: 500 });
  }
}
