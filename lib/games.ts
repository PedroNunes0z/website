import { getRedis } from "@/lib/redis";
import type { GameInput, GameSnapshot } from "@/lib/game-engine";

export type GameId = "haxball" | "hoquei";
export type GameTeam = "blue" | "orange";

export interface GameRoomPlayer {
  id: string;
  name: string;
  team: GameTeam;
  joinedAt: number;
  lastSeen: number;
}

export interface GameRoom {
  id: string;
  game: GameId;
  createdAt: number;
  status: "waiting" | "playing";
  players: GameRoomPlayer[];
}

const ROOM_TTL_SECONDS = 60;
const ROOM_PREFIX = "portfolio:games:room:";
const INDEX_PREFIX = "portfolio:games:index:";

function roomKey(id: string) {
  return `${ROOM_PREFIX}${id}`;
}

function snapshotKey(id: string) {
  return `${ROOM_PREFIX}${id}:snapshot`;
}

function inputsKey(id: string) {
  return `${ROOM_PREFIX}${id}:inputs`;
}

function roomIndex(game: GameId) {
  return `${INDEX_PREFIX}${game}`;
}

export function gameFromString(value: string): GameId | null {
  return value === "haxball" || value === "hoquei" ? value : null;
}

export async function listGameRooms(game: GameId): Promise<GameRoom[]> {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");

  const ids = await redis.zrange<string[]>(roomIndex(game), 0, 29, { rev: true });
  if (!ids.length) return [];

  const rooms = await Promise.all(ids.map((id) => redis.get<GameRoom>(roomKey(id))));
  return rooms.filter((room): room is GameRoom => Boolean(room && room.game === game));
}

export async function getGameRoom(game: GameId, id: string) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  const room = await redis.get<GameRoom>(roomKey(id));
  if (!room || room.game !== game) throw new Error("NOT_FOUND");
  return room;
}

export async function getGameRoomState(game: GameId, id: string) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  const room = await getGameRoom(game, id);
  const [snapshot, inputs] = await Promise.all([
    redis.get<GameSnapshot>(snapshotKey(id)),
    redis.hgetall<Record<string, GameInput>>(inputsKey(id)),
  ]);
  return { room, snapshot, inputs: inputs ?? {} };
}

export async function publishGameInput(game: GameId, id: string, playerId: string, input: GameInput) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  const room = await getGameRoom(game, id);
  if (!room.players.some((player) => player.id === playerId)) throw new Error("NOT_FOUND");
  await redis.hset(inputsKey(id), { [playerId]: input });
  await redis.expire(inputsKey(id), ROOM_TTL_SECONDS);
}

export async function publishGameSnapshot(game: GameId, id: string, playerId: string, snapshot: GameSnapshot) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  const room = await getGameRoom(game, id);
  if (room.players[0]?.id !== playerId || snapshot.game !== game) throw new Error("NOT_HOST");
  await redis.set(snapshotKey(id), snapshot, { ex: ROOM_TTL_SECONDS });
}

export async function createGameRoom(game: GameId, name: string) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");

  const now = Date.now();
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const playerId = crypto.randomUUID();
  const room: GameRoom = {
    id,
    game,
    createdAt: now,
    status: "waiting",
    players: [{ id: playerId, name, team: "blue", joinedAt: now, lastSeen: now }],
  };

  await redis.set(roomKey(id), room, { ex: ROOM_TTL_SECONDS });
  await redis.zadd(roomIndex(game), { score: now, member: id });
  await redis.zremrangebyscore(roomIndex(game), 0, now - ROOM_TTL_SECONDS * 1000);
  return { room, playerId, player: room.players[0] };
}

function maxPlayersPerTeam(game: GameId) {
  return game === "haxball" ? 5 : 1;
}

const JOIN_ROOM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'NOT_FOUND' end
local room = cjson.decode(raw)
if room.game ~= ARGV[6] then return 'NOT_FOUND' end
local now = tonumber(ARGV[1])
local playerId = ARGV[2]
local name = ARGV[3]
local requestedTeam = ARGV[4]
local maxPerTeam = tonumber(ARGV[5])
local fresh = {}
local existing = nil
for _, player in ipairs(room.players) do
  if now - tonumber(player.lastSeen) <= 30000 then
    table.insert(fresh, player)
    if player.id == playerId then existing = player end
  end
end
room.players = fresh
if existing then
  existing.lastSeen = now
  redis.call('SET', KEYS[1], cjson.encode(room), 'EX', 60)
  return 'JOINED'
end
local blue, orange = 0, 0
for _, player in ipairs(room.players) do
  if player.team == 'blue' then blue = blue + 1 else orange = orange + 1 end
end
local team = requestedTeam
if team == 'blue' and blue >= maxPerTeam then team = 'orange' end
if team == 'orange' and orange >= maxPerTeam then team = 'blue' end
if blue >= maxPerTeam and orange >= maxPerTeam then
  redis.call('SET', KEYS[1], cjson.encode(room), 'EX', 60)
  return 'FULL'
end
if team ~= 'blue' and team ~= 'orange' then
  team = blue <= orange and 'blue' or 'orange'
end
local player = { id = playerId, name = name, team = team, joinedAt = now, lastSeen = now }
table.insert(room.players, player)
room.status = #room.players >= 2 and 'playing' or 'waiting'
redis.call('SET', KEYS[1], cjson.encode(room), 'EX', 60)
redis.call('ZADD', KEYS[2], now, room.id)
return 'JOINED'
`;

export async function joinGameRoom(game: GameId, id: string, playerId: string, name: string, team: GameTeam) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");

  const result = await redis.eval<string[], string>(
    JOIN_ROOM_SCRIPT,
    [roomKey(id), roomIndex(game)],
    [String(Date.now()), playerId, name, team, String(maxPlayersPerTeam(game)), game],
  );
  if (result === "FULL") throw new Error("FULL");
  if (result !== "JOINED") throw new Error("NOT_FOUND");
  const room = await getGameRoom(game, id);
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error("NOT_FOUND");
  return { room, player };
}

const HEARTBEAT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'NOT_FOUND' end
local room = cjson.decode(raw)
if room.game ~= ARGV[3] then return 'NOT_FOUND' end
local now = tonumber(ARGV[1])
local playerId = ARGV[2]
local fresh = {}
local found = nil
for _, player in ipairs(room.players) do
  if now - tonumber(player.lastSeen) <= 30000 or player.id == playerId then
    if player.id == playerId then player.lastSeen = now; found = player end
    table.insert(fresh, player)
  end
end
if not found then return 'NOT_FOUND' end
room.players = fresh
room.status = #room.players >= 2 and 'playing' or 'waiting'
redis.call('SET', KEYS[1], cjson.encode(room), 'EX', 60)
redis.call('ZADD', KEYS[2], now, room.id)
return 'ALIVE'
`;

export async function heartbeatGameRoom(game: GameId, id: string, playerId: string) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  const result = await redis.eval<string[], string>(HEARTBEAT_SCRIPT, [roomKey(id), roomIndex(game)], [String(Date.now()), playerId, game]);
  if (result !== "ALIVE") throw new Error("NOT_FOUND");
  const room = await getGameRoom(game, id);
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error("NOT_FOUND");
  return { room, player };
}

export async function leaveGameRoom(game: GameId, id: string, playerId: string) {
  const redis = getRedis();
  if (!redis) return;
  const room = await redis.get<GameRoom>(roomKey(id));
  if (!room || room.game !== game) return;
  const players = room.players.filter((player) => player.id !== playerId);
  if (!players.length) {
    await redis.del(roomKey(id));
    await redis.zrem(roomIndex(game), id);
    return;
  }
  const updated = { ...room, players, status: players.length > 1 ? "playing" as const : "waiting" as const };
  await redis.set(roomKey(id), updated, { ex: ROOM_TTL_SECONDS });
}

export function isValidPlayerName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 20;
}
