import type { GameId, GameRoomPlayer, GameTeam } from "@/lib/games";

export interface GameInput {
  x: number;
  y: number;
  sprint: boolean;
  kickSeq: number;
  dashSeq: number;
  aimX: number;
  aimY: number;
  power: number;
  spin: boolean;
  kickSpin: boolean;
  charging: boolean;
}

export interface GameActor {
  id: string;
  name: string;
  team: GameTeam;
  bot: boolean;  x: number;
  y: number;
  vx: number;
  vy: number;
  cooldown: number;
  stamina: number;
  sprintLock: boolean;
  sprintRest: number;
  facingX: number;
  facingY: number;
  aimX: number;
  aimY: number;
  charge: number;
  curve: boolean;
  dashCooldown: number;
  dashRemaining: number;
  dashX: number;
  dashY: number;
  lastDashSeq: number;
  /** Tempo parado perto da bola lenta: dispara a órbita anti-trava. */
  stall: number;
  /** Clarão pós-chute (s): clareia o personagem e a bola. */
  flash: number;
}

export interface GameObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin?: number;
  rotation?: number;
  flash?: number;
}

export interface GameSnapshot {
  game: GameId;
  field: FieldSize;
  players: GameActor[];
  ball: GameObject;
  score: Record<GameTeam, number>;
  elapsed: number;
  freeze: number;
  winner: GameTeam | null;
  revision: number;
  /** Cruzamento aguardando confirmação: só vira gol se a bola ficar dentro. */
  goalPending: { team: GameTeam; time: number } | null;
  /** Chave da bandeira (SVG em /games/flags/4x3) sorteada por time. */
  flags: Record<GameTeam, string>;
}

export interface BotCounts {
  blue: number;
  orange: number;
}

// Bandeiras em /public/games/flags/4x3 (SVG). Sorteio distinto por time.
const TEAM_FLAG_POOL = [
  "br", "de", "fr", "ar", "es", "it", "pt", "nl",
  "uy", "co", "mx", "us", "jp", "kr", "sn", "ma",
  "hr", "be", "ch", "se", "gb", "ca", "no", "dk",
];

/** Sorteia uma bandeira distinta por time para a partida. */
export function pickTeamFlags(): Record<GameTeam, string> {
  const a = Math.floor(Math.random() * TEAM_FLAG_POOL.length);
  const b = (a + 1 + Math.floor(Math.random() * (TEAM_FLAG_POOL.length - 1))) % TEAM_FLAG_POOL.length;
  return { blue: TEAM_FLAG_POOL[a], orange: TEAM_FLAG_POOL[b] };
}

// Fundo do jogador na cor forte da bandeira (nada de tom pastel).
const FLAG_BG: Record<string, string> = {
  br: "#009c3b", de: "#ffce00", fr: "#0055a4", ar: "#74acdf",
  es: "#c60b1e", it: "#009246", pt: "#046a38", nl: "#ff5f00",
  uy: "#0038a8", co: "#fcd116", mx: "#006847", us: "#3c3b6e",
  jp: "#bc002d", kr: "#0047a0", sn: "#00853f", ma: "#c1272d",
  hr: "#ff0000", be: "#fdda24", ch: "#da291c", se: "#006aa7",
  gb: "#012169", ca: "#ff0000", no: "#ba0c2f", dk: "#c8102e",
};

/** Tom claro da bandeira para o fundo do jogador, ou nulo se desconhecida. */
export function flagBackground(key: string | undefined): string | null {
  if (!key) return null;
  return FLAG_BG[key] ?? null;
}

const FIELD_WIDTH = 1000;
const FIELD_HEIGHT = 560;
const VIEW_HEIGHT = 760;
const GOAL_DEPTH = { haxball: 70, hoquei: 42 };
const GOAL_HALF = { haxball: 85, hoquei: 62 } as Record<GameId, number>;
// Restituição da parede de campo (rebote vivo) vs. malha da rede (amortece).
const FIELD_RESTITUTION = { haxball: 0.72, hoquei: 0.92 } as Record<GameId, number>;
const NET_RESTITUTION = { haxball: 0.16, hoquei: 0.22 } as Record<GameId, number>;
const BALL_RADIUS = 8;
const KICK_RANGE = 16 + BALL_RADIUS + 16;
const emptyInput: GameInput = { x: 0, y: 0, sprint: false, kickSeq: 0, dashSeq: 0, aimX: 0, aimY: 0, power: 0, spin: false, kickSpin: false, charging: false };

export interface FieldSize { w: number; h: number }
export const FULL_FIELD: FieldSize = { w: FIELD_WIDTH, h: FIELD_HEIGHT };

/** Campo proporcional ao tamanho dos times: quanto menos gente, menor o mapa. */
export function fieldFor(game: GameId, totalPlayers: number): FieldSize {
  if (game === "hoquei") return { ...FULL_FIELD };
  if (totalPlayers <= 2) return { w: 560, h: 320 };
  if (totalPlayers <= 4) return { w: 640, h: 360 };
  if (totalPlayers <= 6) return { w: 800, h: 450 };
  if (totalPlayers <= 8) return { w: 920, h: 520 };
  return { ...FULL_FIELD };
}

/** Plano da boca do gol: haxball na borda, hóquei 55 para dentro (linha real). */
export function goalMouth(game: GameId, hw: number): number {
  return game === "hoquei" ? hw - 55 : hw;
}

interface Segment { x1: number; y1: number; x2: number; y2: number }

// Geometria física: a lateral tem abertura real para o gol; a bola rebate na
// rede e nas traves em vez de atravessar a borda.
function walls(game: GameId, hw: number, hh: number): Segment[] {
  const depth = GOAL_DEPTH[game];
  const goal = GOAL_HALF[game];
  const mouth = goalMouth(game, hw);
  return [
    { x1: -mouth - depth, y1: -hh, x2: mouth + depth, y2: -hh },
    { x1: -mouth - depth, y1: hh, x2: mouth + depth, y2: hh },
    { x1: -mouth, y1: -hh, x2: -mouth, y2: -goal },
    { x1: -mouth, y1: goal, x2: -mouth, y2: hh },
    { x1: mouth, y1: -hh, x2: mouth, y2: -goal },
    { x1: mouth, y1: goal, x2: mouth, y2: hh },
    { x1: -mouth - depth, y1: -goal, x2: -mouth - depth, y2: goal },
    { x1: -mouth - depth, y1: -goal, x2: -mouth, y2: -goal },
    { x1: -mouth - depth, y1: goal, x2: -mouth, y2: goal },
    { x1: mouth + depth, y1: -goal, x2: mouth + depth, y2: goal },
    { x1: mouth + depth, y1: -goal, x2: mouth, y2: -goal },
    { x1: mouth + depth, y1: goal, x2: mouth, y2: goal },
  ];
}

interface WallSet { bounds: Segment[]; nets: Segment[] }
const wallsCache = new Map<string, WallSet>();
function wallsFor(game: GameId, hw: number, hh: number): WallSet {
  const key = `${game}-${hw}x${hh}`;
  const cached = wallsCache.get(key);
  if (cached) return cached;
  const all = walls(game, hw, hh);
  const set = { bounds: all.slice(0, 6), nets: all.slice(6) };
  if (wallsCache.size >= 8) wallsCache.clear();
  wallsCache.set(key, set);
  return set;
}

function collideCircleSegment(circle: GameObject, radius: number, segment: Segment, restitution: number) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return;
  const relX = circle.x - segment.x1;
  const relY = circle.y - segment.y1;
  let t = (relX * dx + relY * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = segment.x1 + dx * t;
  const py = segment.y1 + dy * t;
  const nx = circle.x - px;
  const ny = circle.y - py;
  const distSq = nx * nx + ny * ny;
  if (distSq >= radius * radius || distSq === 0) return;
  const distance = Math.sqrt(distSq);
  const inv = 1 / distance;
  const ux = nx * inv;
  const uy = ny * inv;
  circle.x = px + ux * radius;
  circle.y = py + uy * radius;
  const velocity = circle.vx * ux + circle.vy * uy;
  if (velocity < 0) {
    circle.vx -= (1 + restitution) * velocity * ux;
    circle.vy -= (1 + restitution) * velocity * uy;
  }
}

function collidePost(circle: GameObject, radius: number, x: number, y: number) {
  const dx = circle.x - x;
  const dy = circle.y - y;
  const min = radius + 7;
  const distSq = dx * dx + dy * dy;
  if (distSq >= min * min || distSq === 0) return;
  const distance = Math.sqrt(distSq);
  const nx = dx / distance;
  const ny = dy / distance;
  circle.x = x + nx * min;
  circle.y = y + ny * min;
  const velocity = circle.vx * nx + circle.vy * ny;
  if (velocity < 0) {
    circle.vx -= 1.85 * velocity * nx;
    circle.vy -= 1.85 * velocity * ny;
  }
}

function ballInsideNet(ball: GameObject, game: GameId, hw: number) {
  return Math.abs(ball.x) > goalMouth(game, hw) && Math.abs(ball.y) < GOAL_HALF[game];
}

// Tecido da rede: além do rebote fraco nas paredes da rede, o pano segura a
// bola com arrasto forte e mata o giro. Por isso ela morre no fundo em vez
// de voltar para o campo.
function applyNetDrag(ball: GameObject, game: GameId, hw: number, sub: number) {
  if (!ballInsideNet(ball, game, hw)) return;
  const drag = game === "haxball" ? 5.5 : 3.2;
  const keep = Math.max(0, 1 - drag * sub);
  ball.vx *= keep;
  ball.vy *= keep;
  if (ball.spin) {
    ball.spin *= Math.max(0, 1 - 6 * sub);
    if (Math.abs(ball.spin) < 0.05) ball.spin = 0;
  }
}

function keepBallInBounds(ball: GameObject, game: GameId, hw: number, hh: number) {
  const restitution = FIELD_RESTITUTION[game];
  const netRestitution = NET_RESTITUTION[game];
  const mouth = goalMouth(game, hw);
  if (ball.y < -hh + BALL_RADIUS) {
    ball.y = -hh + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * restitution;
  } else if (ball.y > hh - BALL_RADIUS) {
    ball.y = hh - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * restitution;
  }
  const goalClearance = GOAL_HALF[game] - BALL_RADIUS;
  if (Math.abs(ball.y) >= goalClearance) {
    if (ball.x < -mouth + BALL_RADIUS) {
      ball.x = -mouth + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx) * restitution;
    } else if (ball.x > mouth - BALL_RADIUS) {
      ball.x = mouth - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx) * restitution;
    }
  } else {
    // Fundo da rede. Quem não é o host só congela quando o snapshot do host
    // traz o gelo do gol (até ~80 ms depois), então sem este limite a bola
    // atravessaria o gol e sairia de campo nesse intervalo.
    const back = mouth + GOAL_DEPTH[game] - BALL_RADIUS;
    if (ball.x > back) {
      ball.x = back;
      // Rebote morto + atrito tangencial do pano: a bola cai no fundo.
      ball.vx = -Math.abs(ball.vx) * netRestitution;
      ball.vy *= 0.55;
      if (ball.spin) ball.spin *= 0.4;
    } else if (ball.x < -back) {
      ball.x = -back;
      ball.vx = Math.abs(ball.vx) * netRestitution;
      ball.vy *= 0.55;
      if (ball.spin) ball.spin *= 0.4;
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function positionFor(team: GameTeam, index: number, game: GameId, fw: number, fh: number) {
  const direction = team === "blue" ? -1 : 1;
  const sx = fw / FIELD_WIDTH;
  const sy = fh / FIELD_HEIGHT;
  if (game === "hoquei") return { x: direction * 270 * sx, y: 0 };
  const offsets = [-120, 120, 0, -220, 220];
  return { x: direction * (200 + (index % 2) * 95) * sx, y: offsets[index % offsets.length] * sy };
}

function actor(id: string, name: string, team: GameTeam, index: number, game: GameId, bot: boolean, fw: number, fh: number): GameActor {
  const position = positionFor(team, index, game, fw, fh);
  const facingX = team === "blue" ? 1 : -1;
  return {
    id, name, team, bot, ...position, vx: 0, vy: 0, cooldown: 0,
    stamina: 100, sprintLock: false, sprintRest: 0,
    facingX, facingY: 0, aimX: position.x + facingX * 180,
    aimY: position.y, charge: 0, curve: false,
    dashCooldown: 0, dashRemaining: 0, dashX: 0, dashY: 0, lastDashSeq: 0, stall: 0, flash: 0,
  };
}

export function createBotGame(game: GameId, bots: BotCounts, field?: FieldSize): GameSnapshot {
  const players = [actor("local", "VOCÊ", "blue", 0, game, false, FULL_FIELD.w, FULL_FIELD.h)];
  if (game === "haxball") {
    for (let index = 0; index < clamp(bots.blue, 0, 4); index++) {
      players.push(actor(`bot-blue-${index}`, `BOT ${index + 1}`, "blue", index + 1, game, true, FULL_FIELD.w, FULL_FIELD.h));
    }
    for (let index = 0; index < clamp(bots.orange, 1, 5); index++) {
      players.push(actor(`bot-orange-${index}`, `BOT ${index + 1}`, "orange", index, game, true, FULL_FIELD.w, FULL_FIELD.h));
    }
  } else {
    players.push(actor("bot-orange-0", "BOT", "orange", 0, game, true, FULL_FIELD.w, FULL_FIELD.h));
  }
  const sized = field ?? fieldFor(game, players.length);
  replacePositions(players, game, sized);
  return { game, field: sized, goalPending: null, flags: pickTeamFlags(), players, ball: { x: 0, y: 0, vx: 0, vy: 0, rotation: 0 }, score: { blue: 0, orange: 0 }, elapsed: 0, freeze: 0, winner: null, revision: 0 };
}

export function createOnlineGame(game: GameId, roster: GameRoomPlayer[], field?: FieldSize): GameSnapshot {
  const sized = field ?? fieldFor(game, Math.max(roster.length, 1));
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  const players = roster.map((player) => actor(player.id, player.name, player.team, indexes[player.team]++, game, false, sized.w, sized.h));
  return { game, field: sized, goalPending: null, flags: pickTeamFlags(), players, ball: { x: 0, y: 0, vx: 0, vy: 0, rotation: 0 }, score: { blue: 0, orange: 0 }, elapsed: 0, freeze: 0, winner: null, revision: 0 };
}

function replacePositions(players: GameActor[], game: GameId, field: FieldSize) {
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  for (const player of players) {
    const position = positionFor(player.team, indexes[player.team]++, game, field.w, field.h);
    player.x = position.x;
    player.y = position.y;
  }
}

export function updateOnlineRoster(state: GameSnapshot, roster: GameRoomPlayer[]) {
  const known = new Map(state.players.map((player) => [player.id, player]));
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  state.players = roster.map((player) => {
    const index = indexes[player.team]++;
    const existing = known.get(player.id);
    return existing && existing.team === player.team
      ? { ...existing, name: player.name }
      : actor(player.id, player.name, player.team, index, state.game, false, state.field.w, state.field.h);
  });
}

function resetPositions(state: GameSnapshot) {
  state.goalPending = null;
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  state.players.forEach((player) => {
    const position = positionFor(player.team, indexes[player.team]++, state.game, state.field.w, state.field.h);
    player.x = position.x;
    player.y = position.y;
    player.vx = 0;
    player.vy = 0;
    player.cooldown = 0;
    player.stamina = 100;
    player.sprintLock = false;
    player.sprintRest = 0;
    player.charge = 0;
    player.dashCooldown = 0;
    player.dashRemaining = 0;
  });
  state.ball = { x: 0, y: 0, vx: 0, vy: 0, rotation: 0 };
}

function scoreGoal(state: GameSnapshot, team: GameTeam) {
  state.score[team] += 1;
  state.freeze = 1.4;
  if (state.score[team] >= (state.game === "haxball" ? 5 : 7)) state.winner = team;
}

function keepPlayerInBounds(player: GameActor, game: GameId, hw: number, hh: number) {
  const radius = game === "haxball" ? 16 : 24;
  const margin = game === "haxball" ? 46 : 0;
  player.y = clamp(player.y, -hh - margin + radius, hh + margin - radius);
  if (game === "hoquei") {
    player.x = player.team === "blue"
      ? clamp(player.x, -hw + radius, -radius - 4)
      : clamp(player.x, radius + 4, hw - radius);
  } else {
    player.x = clamp(player.x, -hw - margin + radius, hw + margin - radius);
    const nets = wallsFor(game, hw, hh).nets;
    for (let i = 0; i < nets.length; i++) collideCircleSegment(player, radius, nets[i], 0.25);
  }
}

function steer(player: GameActor, input: GameInput, dt: number, game: GameId, hw: number, hh: number) {
  const ix = input.x;
  const iy = input.y;
  const hasInput = ix !== 0 || iy !== 0;
  const length = hasInput ? Math.sqrt(ix * ix + iy * iy) : 1;
  let sprinting = false;
  player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  if (game === "haxball" && !player.bot) {
    // Direção atual do corpo: anda para onde aperta, sem depender da mira.
    if (hasInput) {
      player.facingX = ix / length;
      player.facingY = iy / length;
    }
    sprinting = input.sprint && hasInput && !player.sprintLock && player.stamina > 0;
    if (sprinting) {
      player.stamina = Math.max(0, player.stamina - 32 * dt);
      player.sprintRest = 0;
      if (player.stamina === 0) player.sprintLock = true;
    } else {
      player.sprintRest += dt;
      // Recarga lenta: 12/s após 0,5s parado (barra cheia em ~8s).
      if (player.sprintRest > 0.5) player.stamina = Math.min(100, player.stamina + 12 * dt);
      if (player.stamina >= 25) player.sprintLock = false;
    }
    if (input.charging) {
      player.aimX = input.aimX;
      player.aimY = input.aimY;
      player.charge = clamp(input.power, 0, 1);
      player.curve = input.spin;
    } else {
      player.charge = 0;
      player.curve = false;
    }
    if (input.dashSeq > player.lastDashSeq) {
      player.lastDashSeq = input.dashSeq;
      // Dash na direção do movimento; parado, segue a direção do corpo.
      let dx = ix;
      let dy = iy;
      let runLength = hasInput ? length : 0;
      if (!hasInput) {
        const facingLength = Math.sqrt(player.facingX * player.facingX + player.facingY * player.facingY);
        dx = player.facingX;
        dy = player.facingY;
        runLength = facingLength;
      }
      if (player.stamina >= 28 && player.dashCooldown === 0 && runLength > 0.1) {
        player.stamina -= 28;
        player.sprintRest = 0;
        player.dashCooldown = 1.2;
        player.dashRemaining = 0.13;
        player.dashX = dx / runLength;
        player.dashY = dy / runLength;
        if (player.stamina === 0) player.sprintLock = true;
      }
    }
  }
  const dashing = game === "haxball" && player.dashRemaining > 0;
  const max = game === "haxball" ? (dashing ? 300 : player.bot ? 95 : sprinting ? 130 : 95) : 230;
  if (dashing) {
    player.vx = player.dashX * max;
    player.vy = player.dashY * max;
    player.dashRemaining = Math.max(0, player.dashRemaining - dt);
  } else {
    const reversing = ix * player.vx + iy * player.vy < -1;
    const acceleration = game === "haxball" ? (reversing ? 1200 : 900) : 1900;
    player.vx += (ix / length) * acceleration * dt;
    player.vy += (iy / length) * acceleration * dt;
    if (!hasInput) {
      const drag = Math.max(0, 1 - (game === "haxball" ? 12 : 28) * dt);
      player.vx *= drag;
      player.vy *= drag;
    }
  }
  const speedSq = player.vx * player.vx + player.vy * player.vy;
  if (speedSq > max * max) {
    const scale = max / Math.sqrt(speedSq);
    player.vx *= scale;
    player.vy *= scale;
  }
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  keepPlayerInBounds(player, game, hw, hh);
  player.cooldown = Math.max(0, player.cooldown - dt);
}

function hashId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

// Controle proporcional com frenagem pela velocidade atual: mira o alvo sem
// oscilar em cima dele.
function driveTo(player: GameActor, tx: number, ty: number, gain = 62, dead = 5): GameInput {
  const dx = tx - player.x - player.vx * 0.085;
  const dy = ty - player.y - player.vy * 0.085;
  return { ...emptyInput, x: Math.abs(dx) < dead ? 0 : clamp(dx / gain, -1, 1), y: Math.abs(dy) < dead ? 0 : clamp(dy / gain, -1, 1) };
}

function botInput(player: GameActor, state: GameSnapshot): GameInput {
  const ball = state.ball;
  const hw = state.field.w / 2;
  const hh = state.field.h / 2;
  // dir é a direção de ataque: azul ataca +x, laranja ataca -x.
  const dir = player.team === "blue" ? 1 : -1;
  if (state.game === "hoquei") {
    const mouth = goalMouth(state.game, hw);
    const myGoalX = -dir * mouth;
    const defenseX = myGoalX + dir * 82;
    const approaching = ball.vx * -dir > 40;
    const travel = approaching ? clamp((defenseX - ball.x) / (ball.vx || 1), 0, 0.75) : 0.16;
    const predictedY = reflectedPuckY(ball.y + ball.vy * travel, hh);
    const inOwnHalf = ball.x * -dir > 0;
    const danger = inOwnHalf || (approaching && Math.abs(ball.x - myGoalX) < 600);
    if (approaching && Math.abs(ball.vx) > 200 && Math.abs(ball.x - defenseX) > 95) {
      // Disparo rápido: volta para a linha e intercepta a trajetória prevista.
      return driveTo(player, defenseX, predictedY);
    }
    const ownLo = dir > 0 ? -hw + 27 : 28;
    const ownHi = dir > 0 ? -28 : hw - 27;
    if (danger) {
      // Guarda entre o disco e o gol, espelhando a altura prevista.
      return driveTo(player, clamp(ball.x - dir * 38, ownLo, ownHi), clamp(predictedY, -hh + 27, hh - 27));
    }
    // Ataque: passa para trás do disco (lado do próprio gol) e empurra para
    // frente. A 26 do centro o contato é garantido e religa a jogada.
    if (player.stall > 2) {
      const ang = state.elapsed * 3 + (hashId(player.id) % 10);
      return driveTo(player, ball.x + Math.cos(ang) * 30, clamp(ball.y + Math.sin(ang) * 30, -hh + 27, hh - 27));
    }
    return driveTo(player, clamp(ball.x + dir * 26, ownLo, ownHi), clamp(ball.y * 0.85, -hh + 27, hh - 27));
  }
  // Haxball: papéis por ordem no time (0 perseguidor, 1 apoio, 2 defesa e o
  // último de 3+ vira goleiro). A mira é sempre no gol adversário, então o
  // bot nunca faz gol contra.
  const attackX = dir * hw;
  const myGoalX = -dir * hw;
  const sameTeam = state.players.filter((other) => other.team === player.team);
  const rank = sameTeam.indexOf(player);
  const last = sameTeam.length - 1;
  const lane = ((hashId(player.id) % 3) - 1) * 26;
  // Balanço de patrulha: ninguém fica congelado quando a bola para longe.
  const sway = Math.sin(state.elapsed * 1.3 + hashId(player.id) * 0.7) * 14;
  const aimY = clamp(ball.y * 0.25 + Math.sin(state.elapsed * 2.1 + player.x * 0.03) * 30, -60, 60);
  const power = botShotPower(player, state);
  let targetX: number;
  let targetY: number;
  if (last > 1 && rank === last) {
    targetX = myGoalX + dir * 34;
    targetY = clamp(ball.y * 0.5 + sway * 0.5, -52, 52);
  } else if (rank === 0) {
    if (player.stall > 1.2) {
      // Travou colado na bola lenta: orbita até achar o cone do chute.
      const ang = state.elapsed * 3 + (hashId(player.id) % 10);
      targetX = ball.x + Math.cos(ang) * 30;
      targetY = ball.y + Math.sin(ang) * 30;
    } else {
      targetX = ball.x - dir * 12;
      targetY = ball.y + lane * 0.3;
    }
  } else if (rank === 1) {
    targetX = clamp(ball.x + dir * 150, -hw + 40, hw - 40);
    targetY = clamp(ball.y * 0.6 + lane + sway, -hh + 40, hh - 40);
  } else {
    targetX = myGoalX + dir * (Math.abs(ball.x - myGoalX) * 0.4);
    targetY = clamp(ball.y * 0.5 + lane * 0.5 + sway, -hh + 40, hh - 40);
  }
  const move = driveTo(player, targetX, targetY, 80, 8);
  return { ...move, aimX: attackX, aimY, power };
}

export function botShotPower(player: GameActor, state: GameSnapshot) {
  const hw = state.field.w / 2;
  const distance = Math.abs((player.team === "blue" ? hw : -hw) - state.ball.x);
  const variation = (Math.sin(state.elapsed * 3.7 + player.id.length * 1.9 + player.y * 0.02) + 1) / 2;
  return clamp(0.3 + 0.22 * (distance / state.field.w) + 0.22 * variation, 0.3, 0.74);
}

function reflectedPuckY(y: number, hh: number) {
  const edge = hh - BALL_RADIUS;
  const period = 4 * edge;
  const phase = ((y + edge) % period + period) % period;
  return phase <= 2 * edge ? phase - edge : 3 * edge - phase;
}

export function resolveKickDirection(player: Pick<GameActor, "x" | "y">, ball: Pick<GameObject, "x" | "y">, aimX: number, aimY: number) {
  const toBallX = ball.x - player.x;
  const toBallY = ball.y - player.y;
  const ballDistanceSq = toBallX * toBallX + toBallY * toBallY;
  const dx = aimX - player.x;
  const dy = aimY - player.y;
  const aimDistanceSq = dx * dx + dy * dy;
  if (ballDistanceSq < 1 || aimDistanceSq < 1) return null;
  const ballAngle = Math.atan2(toBallY, toBallX);
  const aimAngle = Math.atan2(dy, dx);
  const difference = Math.atan2(Math.sin(aimAngle - ballAngle), Math.cos(aimAngle - ballAngle));
  if (Math.abs(difference) >= Math.PI / 2) return null;
  const angle = ballAngle + clamp(difference, -Math.PI / 4, Math.PI / 4);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function collideCircles(a: GameObject, b: GameObject, radiusA: number, radiusB: number, massA: number, massB: number, restitution: number, ballBoostAmount = 0, shove = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minimum = radiusA + radiusB;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minimum * minimum) return;
  const distance = Math.sqrt(distSq);
  const nx = distance > 0.001 ? dx / distance : 1;
  const ny = distance > 0.001 ? dy / distance : 0;
  const overlap = minimum - distance;
  const total = massA + massB;
  const shareA = massB / total;
  const shareB = massA / total;
  a.x -= nx * overlap * shareA;
  a.y -= ny * overlap * shareA;
  b.x += nx * overlap * shareB;
  b.y += ny * overlap * shareB;
  const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relative >= 0) return;
  const impulse = -(1 + restitution) * relative / (1 / massA + 1 / massB);
  a.vx -= impulse / massA * nx;
  a.vy -= impulse / massA * ny;
  b.vx += impulse / massB * nx;
  b.vy += impulse / massB * ny;
  if (ballBoostAmount) {
    b.vx += a.vx * ballBoostAmount;
    b.vy += a.vy * ballBoostAmount;
  }
  // Empurrão de corpo: bola rápida empurra o jogador para trás na normal.
  if (shove) {
    const approach = -(relative);
    if (approach > 0) {
      a.vx -= nx * approach * shove;
      a.vy -= ny * approach * shove;
    }
  }
}

function kick(state: GameSnapshot, player: GameActor, input: GameInput) {
  if (player.cooldown > 0 || state.freeze > 0) return;
  const ball = state.ball;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  if (dx * dx + dy * dy > KICK_RANGE * KICK_RANGE) return;
  const direction = resolveKickDirection(player, ball, input.aimX, input.aimY);
  if (!direction) return;
  const speed = 430 * (0.35 + 0.65 * clamp(input.power, 0, 1));
  ball.vx = direction.x * speed + player.vx * 0.35;
  ball.vy = direction.y * speed + player.vy * 0.35;
  ball.spin = input.kickSpin ? 8 : (ball.spin ?? 0) * 0.3;
  player.cooldown = 0.45;
  player.flash = 0.18;
  ball.flash = 0.18;
}

export interface StepOptions {
  /**
   * `false` para o cliente convidado: placar, gelo e vencedor são escritos
   * apenas pelo host, então a simulação local assiste ao gol pelo snapshot em
   * vez de marcá-lo sozinha (evita gol fantasma quando as duas simulações
   * divergem na linha de gol).
   */
  authoritative?: boolean;
  /**
   * Gol adiado para o replay: o motor avisa via `onGoal` quando a bola cruza
   * a linha inteira, mas não marca nem gela. Quem chama aplica o placar com
   * `applyGoal()` depois do replay (placar, replay e volta ao jogo).
   */
  deferGoal?: boolean;
  onGoal?: (team: GameTeam) => void;
  /** Avisa no instante em que a bola cruza a linha (antes da espera). */
  onCross?: (team: GameTeam) => void;
}

/** Espera após o cruzamento: o gol só vale se a bola ficar dentro da rede. */
const GOAL_DWELL = 0.8;

/** Aplica um gol adiado (`deferGoal`): placar + gelo que termina no reset. */
export function applyGoal(state: GameSnapshot, team: GameTeam) {
  if (state.winner || state.freeze > 0) return;
  scoreGoal(state, team);
}

export function stepGame(
  state: GameSnapshot,
  inputs: Record<string, GameInput>,
  lastKicks: Record<string, number>,
  dt: number,
  options: StepOptions = {},
) {
  const authoritative = options.authoritative !== false;
  if (state.winner) return;
  const delta = clamp(dt, 0, 0.05);
  if (state.freeze > 0) {
    state.freeze -= delta;
    if (state.freeze <= 0) resetPositions(state);
    return;
  }
  state.elapsed += delta;
  for (const actor of state.players) actor.flash = Math.max(0, actor.flash - delta);
  if (typeof state.ball.flash === "number") state.ball.flash = Math.max(0, state.ball.flash - delta);
  const isHaxball = state.game === "haxball";
  const hw = state.field.w / 2;
  const hh = state.field.h / 2;
  const mouth = goalMouth(state.game, hw);
  const { bounds, nets } = wallsFor(state.game, hw, hh);
  const fieldRest = FIELD_RESTITUTION[state.game];
  const netRest = NET_RESTITUTION[state.game];
  const goalHalf = GOAL_HALF[state.game];
  const friction = isHaxball ? 0.6 : 0.45;
  const stopSq = isHaxball ? 64 : 36;
  const max = isHaxball ? 850 : 950;
  const playerRadius = isHaxball ? 16 : 24;
  const playerMass = isHaxball ? 3 : 6;
  // Encostar tem peso: restituição e impulso que dão sensação de contato.
  const playerRest = isHaxball ? 0.55 : 0.95;
  const touchBoost = isHaxball ? 0.14 : 0.18;

  const goalThreshold = mouth + BALL_RADIUS;
  const goalOpen = Math.abs(state.ball.y) < goalHalf - BALL_RADIUS;

  // Gol com espera: a bola precisa ficar inteira além da boca pela espera.
  // Se sair de volta antes disso, segue o jogo sem placar e sem parar.
  if (state.goalPending) {
    const pending = state.goalPending;
    const beyond = pending.team === "orange" ? state.ball.x < -goalThreshold : state.ball.x > goalThreshold;
    if (!beyond || !goalOpen) {
      state.goalPending = null;
    } else {
      pending.time += delta;
      if (pending.time >= GOAL_DWELL) {
        state.goalPending = null;
        if (authoritative) {
          if (options.deferGoal) options.onGoal?.(pending.team);
          else scoreGoal(state, pending.team);
        }
      }
    }
  }

  // Amostra os inputs uma vez por tick (não por substep): corta ~3x o custo da
  // IA e o lixo de objetos sem mudar o comportamento em 16 ms.
  const tickInputs: Record<string, GameInput> = {};
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    if (player.bot) {
      // Anti-trava: bola lenta + bot parado por perto acumula stall e a IA
      // passa a orbitar a bola até achar ângulo de chute ou empurrão.
      const bdx = state.ball.x - player.x;
      const bdy = state.ball.y - player.y;
      const ballSpeed = Math.sqrt(state.ball.vx * state.ball.vx + state.ball.vy * state.ball.vy);
      const botSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
      const near = isHaxball ? 130 : 150;
      if (ballSpeed < 30 && botSpeed < 25 && bdx * bdx + bdy * bdy < near * near) player.stall += delta;
      else player.stall = 0;
    }
    tickInputs[player.id] = player.bot ? botInput(player, state) : (inputs[player.id] ?? emptyInput);
  }

  const steps = 3;
  for (let step = 0; step < steps; step++) {
    const sub = delta / steps;
    for (let i = 0; i < state.players.length; i++) {
      const player = state.players[i];
      const input = tickInputs[player.id];
      steer(player, input, sub, state.game, hw, hh);
      if (isHaxball) {
        const nearSq = (state.ball.x - player.x) * (state.ball.x - player.x) + (state.ball.y - player.y) * (state.ball.y - player.y);
        if (player.bot) {
          if (nearSq < 48 * 48) kick(state, player, input);
        } else if (input.kickSeq > (lastKicks[player.id] ?? 0)) {
          lastKicks[player.id] = input.kickSeq;
          kick(state, player, input);
        }
      }
    }

    const ball = state.ball;
    const dragKeep = Math.max(0, 1 - friction * sub);
    ball.vx *= dragKeep;
    ball.vy *= dragKeep;
    if (isHaxball && ball.spin) {
      const speedSq = ball.vx * ball.vx + ball.vy * ball.vy;
      if (speedSq > 400) {
        const speed = Math.sqrt(speedSq);
        const curve = (ball.spin * 42 * sub) / speed;
        ball.vx += -ball.vy * curve;
        ball.vy += ball.vx * curve;
      }
      ball.spin *= Math.max(0, 1 - 1.1 * sub);
      if (Math.abs(ball.spin) < 0.05) ball.spin = 0;
    }
    applyNetDrag(ball, state.game, hw, sub);
    if (ball.vx * ball.vx + ball.vy * ball.vy < stopSq) { ball.vx = 0; ball.vy = 0; }
    ball.x += ball.vx * sub;
    ball.y += ball.vy * sub;
    if (isHaxball) ball.rotation = (ball.rotation ?? 0) + ((ball.vx * 0.25 + ball.vy * 0.2) / BALL_RADIUS + (ball.spin ?? 0) * 1.5) * sub;
    // Contorno com rebote vivo, rede com rebote morto (tecido).
    for (let i = 0; i < bounds.length; i++) collideCircleSegment(ball, BALL_RADIUS, bounds[i], fieldRest);
    for (let i = 0; i < nets.length; i++) collideCircleSegment(ball, BALL_RADIUS, nets[i], netRest);
    keepBallInBounds(ball, state.game, hw, hh);
    if (isHaxball) {
      for (const x of [-mouth, mouth]) {
        collidePost(ball, BALL_RADIUS, x, -goalHalf);
        collidePost(ball, BALL_RADIUS, x, goalHalf);
      }
      for (let first = 0; first < state.players.length; first++) {
        for (let second = first + 1; second < state.players.length; second++) {
          collideCircles(state.players[first], state.players[second], 16, 16, 3, 3, 0.4);
        }
      }
    }
    for (let i = 0; i < state.players.length; i++) {
      const player = state.players[i];
      // Toque proporcional à chegada: encostar devagar quase não desloca a
      // bola; chegar rápido transfere de verdade.
      const cdx = ball.x - player.x;
      const cdy = ball.y - player.y;
      const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
      const cnx = cdist > 0.001 ? cdx / cdist : 1;
      const cny = cdist > 0.001 ? cdy / cdist : 0;
      const approach = -((ball.vx - player.vx) * cnx + (ball.vy - player.vy) * cny);
      const touch = clamp((approach - 60) / 400, 0, 1);
      collideCircles(player, ball, playerRadius, BALL_RADIUS, playerMass, 1,
        playerRest * (0.2 + 0.8 * touch), touchBoost * touch, isHaxball ? 0.35 * touch : 0);
      keepPlayerInBounds(player, state.game, hw, hh);
    }
    for (let i = 0; i < bounds.length; i++) collideCircleSegment(ball, BALL_RADIUS, bounds[i], fieldRest);
    for (let i = 0; i < nets.length; i++) collideCircleSegment(ball, BALL_RADIUS, nets[i], netRest);
    keepBallInBounds(ball, state.game, hw, hh);
    const ballSpeedSq = ball.vx * ball.vx + ball.vy * ball.vy;
    if (ballSpeedSq > max * max) {
      const scale = max / Math.sqrt(ballSpeedSq);
      ball.vx *= scale;
      ball.vy *= scale;
    }
    // Cruzamento integral avisa e abre a espera; o placar sai depois, no
    // topo do passo, se a bola continuar dentro. Sem parar o jogo na hora.
    const crossedLeft = ball.x < -goalThreshold && Math.abs(ball.y) < goalHalf - BALL_RADIUS;
    const crossedRight = ball.x > goalThreshold && Math.abs(ball.y) < goalHalf - BALL_RADIUS;
    const crossed = crossedLeft ? "orange" as const : crossedRight ? "blue" as const : null;
    if (crossed) {
      if (authoritative && !state.goalPending) {
        state.goalPending = { team: crossed, time: 0 };
        options.onCross?.(crossed);
      }
      break;
    }
  }
  state.revision += 1;
}

// Convergência da simulação local de um convidado em direção ao snapshot do host.
const CORRECTION_TAU = 0.15;
const LOCAL_CORRECTION_TAU = 0.35;
const LOCAL_DEADZONE = 16;
const SNAP_DISTANCE = 80;

/**
 * Reconcilia a simulação local de um cliente convidado com o snapshot
 * autoritativo do host.
 *
 * O convidado roda a mesma física a 60 fps, mas com um `dt` próprio e inputs
 * remotos que chegam em intervalos de rede. A deriva em relação ao host é
 * inevitável: em vez de trocar o estado inteiro a cada snapshot (o que faria
 * o jogo "pular" na taxa de rede), posições e velocidades convergem
 * exponencialmente para o alvo e apenas divergências grandes (gol, reset de
 * posições) aplicam snap instantâneo.
 *
 * Estado discreto (placar, gelo, vencedor e elenco) é sempre do host, e o
 * pawn próprio do convidado recebe uma correção mais leve para não sentir
 * "elástico" no controle.
 */
export function reconcileAuthoritativeState(
  local: GameSnapshot,
  target: GameSnapshot | null,
  localPlayerId: string | null,
  dt: number,
) {
  if (!target || local === target || !(dt > 0)) return;

  // Reiniciar a partida faz o relógio do host voltar a zero; nesse caso o alvo
  // manda, senão a partida nunca mais voltaria a contar do começo.
  const restarted = target.elapsed + 1 < local.elapsed;
  local.score.blue = target.score.blue;
  local.score.orange = target.score.orange;
  if (target.flags) local.flags = { ...target.flags };
  local.winner = target.winner;
  local.freeze = restarted ? target.freeze : Math.max(local.freeze, target.freeze);
  local.elapsed = restarted ? target.elapsed : Math.max(local.elapsed, target.elapsed);

  // Elenco: quem saiu some, quem entrou copia o estado autoritativo.
  const known = new Map(local.players.map((player) => [player.id, player]));
  local.players = local.players.filter((player) => target.players.some((entry) => entry.id === player.id));
  for (const entry of target.players) {
    const existing = known.get(entry.id);
    if (existing) {
      existing.team = entry.team;
      existing.name = entry.name;
    } else {
      local.players.push({ ...entry });
    }
  }

  const gain = 1 - Math.exp(-dt / CORRECTION_TAU);
  const localGain = 1 - Math.exp(-dt / LOCAL_CORRECTION_TAU);
  for (const actor of local.players) {
    const authoritative = target.players.find((entry) => entry.id === actor.id);
    if (!authoritative) continue;
    const dx = authoritative.x - actor.x;
    const dy = authoritative.y - actor.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > SNAP_DISTANCE) {
      // Reset de posições ou teleporte: adota tudo, menos `lastDashSeq`, que só
      // pode avançar (voltar para trás reativaria um dash já consumido).
      const lastDashSeq = Math.max(actor.lastDashSeq, authoritative.lastDashSeq);
      Object.assign(actor, authoritative, { lastDashSeq });
      continue;
    }
    const isLocal = actor.id === localPlayerId;
    if (isLocal && distance < LOCAL_DEADZONE) continue;
    const weight = isLocal ? localGain : gain;
    actor.x += dx * weight;
    actor.y += dy * weight;
    actor.vx += (authoritative.vx - actor.vx) * weight;
    actor.vy += (authoritative.vy - actor.vy) * weight;
  }

  const ball = local.ball;
  const authoritativeBall = target.ball;
  // Compensação de latência da bola: o snapshot publicado pelo host chega com
  // o atraso da rede e a simulação local está alguns milissegundos à frente
  // (local.elapsed - target.elapsed indica a latência). Extrapolar a bola pela
  // própria velocidade nesse intervalo faz o convidado ver a bola no presente,
  // e não onde ela estava quando o host publicou. Isso mata a sensação de lag.
  const ballDelay = target.freeze > 0 ? 0 : clamp(local.elapsed - target.elapsed, 0, 0.25);
  const targetBallSpeed = Math.hypot(authoritativeBall.vx, authoritativeBall.vy);
  const ballLead = targetBallSpeed > 30 ? ballDelay : 0;
  const authoritativeBallX = authoritativeBall.x + authoritativeBall.vx * ballLead;
  const authoritativeBallY = authoritativeBall.y + authoritativeBall.vy * ballLead;
  const ballX = authoritativeBallX - ball.x;
  const ballY = authoritativeBallY - ball.y;
  const ballDistance = Math.hypot(ballX, ballY);
  if (ballDistance > SNAP_DISTANCE) {
    ball.x = authoritativeBallX;
    ball.y = authoritativeBallY;
    ball.vx = authoritativeBall.vx;
    ball.vy = authoritativeBall.vy;
    ball.spin = authoritativeBall.spin;
  } else {
    ball.x += ballX * gain;
    ball.y += ballY * gain;
    ball.vx += (authoritativeBall.vx - ball.vx) * gain;
    ball.vy += (authoritativeBall.vy - ball.vy) * gain;
  }
}

// ---------------------------------------------------------------------------
// Renderização dos campos
// ---------------------------------------------------------------------------

function drawNetMesh(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bulge: number,
  flip: boolean,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.38)";
  ctx.lineWidth = 1;
  const step = 9;
  ctx.beginPath();
  for (let gx = x; gx <= x + w + 0.5; gx += step) {
    const sag = bulge * Math.sin(((gx - x) / w) * Math.PI) * (flip ? -1 : 1);
    ctx.moveTo(gx + sag, y);
    ctx.lineTo(gx + sag, y + h);
  }
  for (let gy = y; gy <= y + h + 0.5; gy += step) {
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
  }
  ctx.stroke();
  ctx.restore();
}

function paintHaxballStatic(ctx: CanvasRenderingContext2D, fw: number, fh: number) {
  const hw = fw / 2;
  const hh = fh / 2;
  const sx = fw / FIELD_WIDTH;
  const sy = fh / FIELD_HEIGHT;
  const s = Math.min(sx, sy);
  // Entorno escuro + gramado com listras de corte (mow stripes).
  ctx.fillStyle = "#0d1a0f";
  ctx.fillRect(-hw - 130, -hh - 130, fw + 260, fh + 260);
  const stripes = 10;
  const stripeW = fw / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#2f9e44" : "#2a9140";
    ctx.fillRect(-hw + i * stripeW, -hh, stripeW + 0.5, fh);
  }
  // Textura de grama: milhares de fios determinísticos (LCG com seed fixa.
  // O campo redesenha igual a cada resize, sem cintilar).
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const specks = Math.round(4200 * sx * sy);
  for (let i = 0; i < specks; i++) {
    const x = -hw + rand() * fw;
    const y = -hh + rand() * fh;
    ctx.fillStyle = rand() > 0.5 ? "rgba(18,84,32,0.12)" : "rgba(130,225,145,0.09)";
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 1.5);
  }
  // Brilho sutil de cima para dar volume sem tirar o fosco do gramado.
  const sheen = ctx.createLinearGradient(0, -hh, 0, hh);
  sheen.addColorStop(0, "rgba(255,255,255,0.06)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.10)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-hw, -hh, fw, fh);

  // Marcações brancas oficiais: contorno, meio-campo, círculo central, áreas.
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.strokeRect(-hw, -hh, fw, fh);
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(0, hh);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 75 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  // Áreas proporcionais ao mapa + marcas de pênalti + arcos.
  const bigDepth = 140 * sx;
  const bigHalf = 160 * sy;
  const smallDepth = 55 * sx;
  const smallHalf = 95 * sy;
  for (const side of [-1, 1] as const) {
    const gx = side * hw;
    const bigX = side < 0 ? gx : gx - bigDepth;
    const smallX = side < 0 ? gx : gx - smallDepth;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(bigX, -bigHalf, bigDepth, bigHalf * 2);
    ctx.strokeRect(smallX, -smallHalf, smallDepth, smallHalf * 2);
    const spotX = side * (hw - 105 * sx);
    ctx.beginPath();
    ctx.arc(spotX, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // Meia-lua: termina exatamente na linha da área, então o traço nunca
    // cruza nem vaza para dentro da área.
    const arcHalf = Math.acos(35 / 52);
    const arcR = 52 * sx;
    ctx.beginPath();
    if (side < 0) ctx.arc(spotX, 0, arcR, -arcHalf, arcHalf);
    else ctx.arc(spotX, 0, arcR, Math.PI - arcHalf, Math.PI + arcHalf);
    ctx.stroke();
  }
  // Escanteios: só o quarto de círculo voltado para dentro do campo.
  ctx.lineWidth = 3;
  for (const qx of [-1, 1]) {
    for (const qy of [-1, 1]) {
      const mid = Math.atan2(-qy, -qx);
      ctx.beginPath();
      ctx.arc(qx * hw, qy * hh, 14, mid - Math.PI / 4, mid + Math.PI / 4);
      ctx.stroke();
    }
  }

  // Redes chapadas na camada estática; a barriga do pano é redesenhada por
  // cima a cada frame só enquanto a bola está na rede (ver drawGame).
  const goalHalf = GOAL_HALF.haxball;
  const depth = GOAL_DEPTH.haxball;
  drawNetMesh(ctx, -hw - depth, -goalHalf, depth, goalHalf * 2, 0, true);
  drawNetMesh(ctx, hw, -goalHalf, depth, goalHalf * 2, 0, false);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.strokeRect(-hw - depth, -goalHalf, depth, goalHalf * 2);
  ctx.strokeRect(hw, -goalHalf, depth, goalHalf * 2);

  // Traves e travessões internos.
  for (const x of [-hw, hw]) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, -goalHalf);
    ctx.lineTo(x, goalHalf);
    ctx.stroke();
    for (const y of [-goalHalf, goalHalf]) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#14532d";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function paintHockeyStatic(ctx: CanvasRenderingContext2D, fw: number, fh: number) {
  const hw = fw / 2;
  const hh = fh / 2;
  // Boca do gol sobre a linha, 55 para dentro do fundo, como no rinque real.
  // A rede mora DENTRO do rinque, nunca para fora das tabelas.
  const mouth = goalMouth("hoquei", hw);
  const RED = "rgba(200,16,46,0.55)";
  const RED_SOLID = "rgba(200,16,46,0.8)";
  const BLUE = "rgba(11,61,145,0.6)";
  const BLUE_SOLID = "rgba(11,61,145,0.85)";
  const BLACK = "rgba(17,17,17,0.6)";
  const ICE = "#edf0f2";
  // Gelo fosco: chapado, sem gradiente brilhante.
  ctx.fillStyle = "#101418";
  ctx.fillRect(-hw - 90, -hh - 90, fw + 180, fh + 180);
  ctx.fillStyle = ICE;
  ctx.fillRect(-hw, -hh, fw, fh);
  // Reflexo quase imperceptível do gelo (mantém o fosco).
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(-hw, -hh, fw, 26);

  // Tabelas: contorno preto + rodapé amarelo (kickplate).
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 10;
  ctx.strokeRect(-hw, -hh, fw, fh);
  ctx.strokeStyle = "#e8b921";
  ctx.lineWidth = 5;
  ctx.strokeRect(-hw + 8, -hh + 8, fw - 16, fh - 16);

  // Linhas longas recortadas no gelo: terminam no kickplate e nunca
  // encostam nem vazam para fora das tabelas.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-hw + 11, -hh + 11, fw - 22, fh - 22);
  ctx.clip();
  // Linha central vermelha + círculo central azul.
  ctx.fillStyle = RED;
  ctx.fillRect(-6, -hh, 12, fh);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = BLUE_SOLID;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();

  // Linhas azuis das zonas.
  ctx.fillStyle = BLUE;
  for (const x of [-fw * 0.16, fw * 0.16]) ctx.fillRect(x - 8, -hh, 16, fh);

  // Linha do gol + crease colado na boca, tudo dentro do rinque.
  ctx.fillStyle = RED;
  for (const x of [-mouth, mouth]) ctx.fillRect(x - 2, -hh, 4, fh);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(-hw, -hh, fw, fh);
  ctx.clip();
  for (const side of [-1, 1] as const) {
    const cx = side * mouth;
    ctx.fillStyle = "rgba(120,180,230,0.45)";
    ctx.beginPath();
    ctx.arc(cx, 0, 32, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = RED_SOLID;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();

  // Círculos de faceoff: vermelhos com ponto central + marcas de hash.
  const fSpotX = fw * 0.3;
  const fSpotY = fh * 0.285;
  const spots: Array<[number, number]> = [[-fSpotX, -fSpotY], [-fSpotX, fSpotY], [fSpotX, -fSpotY], [fSpotX, fSpotY]];
  for (const [fx, fy] of spots) {
    ctx.strokeStyle = RED;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(fx, fy, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = RED_SOLID;
    ctx.beginPath();
    ctx.arc(fx, fy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(fx + s * 78, fy - 22);
      ctx.lineTo(fx + s * 92, fy - 22);
      ctx.moveTo(fx + s * 78, fy + 22);
      ctx.lineTo(fx + s * 92, fy + 22);
      ctx.stroke();
    }
  }
  // Pontos de faceoff da zona neutra.
  ctx.fillStyle = RED_SOLID;
  for (const [fx, fy] of [[-fw * 0.09, -fSpotY], [-fw * 0.09, fSpotY], [fw * 0.09, -fSpotY], [fw * 0.09, fSpotY]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.arc(fx, fy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Redes do hóquei: armação vermelha + malha branca, dentro do rinque.
  const goalHalf = GOAL_HALF.hoquei;
  const depth = GOAL_DEPTH.hoquei;
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? -mouth - depth : mouth;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, -goalHalf, depth, goalHalf * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(x, -goalHalf, depth, goalHalf * 2);
    ctx.strokeStyle = "rgba(120,130,140,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = x; gx <= x + depth; gx += 8) {
      ctx.moveTo(gx, -goalHalf);
      ctx.lineTo(gx, goalHalf);
    }
    for (let gy = -goalHalf; gy <= goalHalf; gy += 8) {
      ctx.moveTo(x, gy);
      ctx.lineTo(x + depth, gy);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = RED_SOLID;
    ctx.lineWidth = 4;
    ctx.strokeRect(x, -goalHalf, depth, goalHalf * 2);
    ctx.fillStyle = RED_SOLID;
    for (const y of [-goalHalf, goalHalf]) {
      ctx.beginPath();
      ctx.arc(side * mouth, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Camada estática do campo: pintada uma vez por (jogo, tamanho e resolução)
// e copiada com um único drawImage por frame. Isso tira o render de centenas
// de operações vetoriais por frame para cerca de 40, o ganho que devolve o
// FPS aos 60+.
const fieldLayers = new Map<string, HTMLCanvasElement>();

function fieldLayer(game: GameId, fw: number, fh: number, w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${game}-${fw}x${fh}-${w}x${h}`;
  const cached = fieldLayers.get(key);
  if (cached) return cached;
  if (fieldLayers.size >= 6) {
    const oldest = fieldLayers.keys().next();
    if (!oldest.done) fieldLayers.delete(oldest.value);
  }
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(w));
  layer.height = Math.max(1, Math.round(h));
  const g = layer.getContext("2d");
  if (!g) return null;
  g.translate(layer.width / 2, layer.height / 2);
  g.scale(layer.width / 1160, layer.height / VIEW_HEIGHT);
  if (game === "haxball") paintHaxballStatic(g, fw, fh);
  else paintHockeyStatic(g, fw, fh);
  fieldLayers.set(key, layer);
  return layer;
}

export interface DrawOptions {
  /** Degradação: pula os nomes dos jogadores para poupar rasterização. */
  hideNames?: boolean;
  /** Câmera dinâmica: centro seguido e zoom (1 = campo inteiro). */
  cam?: { x: number; y: number; zoom: number };
}

// Sprites de texto: fillText por frame é um dos custos mais altos em
// renderização por software. Cada rótulo vira um bitmap uma vez e é copiado
// com drawImage depois. Supersample 2x para não pixelizar no hidpi.
const labelSprites = new Map<string, { img: HTMLCanvasElement; w: number; h: number }>();
let measureContext: CanvasRenderingContext2D | null = null;
const SPRITE_SS = 2;

function labelSprite(text: string, font: string, fill: string): { img: HTMLCanvasElement; w: number; h: number } | null {
  if (typeof document === "undefined") return null;
  const key = `${font}|${fill}|${text}`;
  const cached = labelSprites.get(key);
  if (cached) return cached;
  if (labelSprites.size >= 64) labelSprites.clear();
  if (!measureContext) {
    const measureCanvas = document.createElement("canvas");
    measureContext = measureCanvas.getContext("2d");
  }
  if (!measureContext) return null;
  measureContext.font = font;
  const sizeMatch = font.match(/(\d+)px/);
  const h = sizeMatch ? Math.ceil(Number(sizeMatch[1]) * 1.25) : 16;
  const w = Math.max(h, Math.ceil(measureContext.measureText(text).width) + 6);
  const img = document.createElement("canvas");
  img.width = w * SPRITE_SS;
  img.height = h * SPRITE_SS;
  const g = img.getContext("2d");
  if (!g) return null;
  g.scale(SPRITE_SS, SPRITE_SS);
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = fill;
  g.fillText(text, w / 2, h / 2 + 0.5);
  const sprite = { img, w, h };
  labelSprites.set(key, sprite);
  return sprite;
}

const flagImages = new Map<string, HTMLImageElement>();

function drawFlag(ctx: CanvasRenderingContext2D, key: string | undefined, x: number, y: number, w: number) {
  if (!key || typeof document === "undefined") return;
  let img = flagImages.get(key);
  if (!img) {
    img = new Image();
    img.src = `/games/flags/4x3/${key}.svg`;
    flagImages.set(key, img);
    return;
  }
  // drawImage com imagem incompleta lança: só desenha quando carregou.
  if (!img.complete || img.naturalWidth === 0) return;
  const h = (w * 3) / 4;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
}

export function drawGame(ctx: CanvasRenderingContext2D, state: GameSnapshot, localPlayerId: string, opts: DrawOptions = {}) {
  const { width, height } = ctx.canvas;
  const cam = opts.cam;
  const zoom = cam?.zoom ?? 1;
  const camX = cam?.x ?? 0;
  const camY = cam?.y ?? 0;
  const scale = Math.min(width / 1160, height / VIEW_HEIGHT) * zoom;
  const layer = fieldLayer(state.game, state.field.w, state.field.h, width, height);
  // Transformação direta em vez de save/translate/scale: exata e sem pilha.
  // Com câmera, o centro seguido cai no meio da tela em qualquer zoom.
  ctx.setTransform(scale, 0, 0, scale, width / 2 - camX * scale, height / 2 - camY * scale);
  if (layer) {
    // O blit cobre o canvas inteiro 1:1: sem clearRect/fillRect por cima.
    ctx.drawImage(layer, -580, -380, 1160, 760);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = state.game === "haxball" ? "#0d1a0f" : "#101418";
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, width / 2 - camX * scale, height / 2 - camY * scale);
    if (state.game === "haxball") paintHaxballStatic(ctx, state.field.w, state.field.h);
    else paintHockeyStatic(ctx, state.field.w, state.field.h);
  }

  const onIce = state.game === "hoquei";
  const homeFill = onIce ? "#2456e6" : "#fffdf9";
  const awayFill = onIce ? "#d7263d" : "#ff8d4f";
  for (const player of state.players) {
    const radius = onIce ? 24 : 16;
    ctx.beginPath(); ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = flagBackground(state.flags?.[player.team]) ?? (player.team === "blue" ? homeFill : awayFill);
    ctx.fill();
    if (player.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.65, (player.flash / 0.18) * 0.65)})`;
      ctx.beginPath(); ctx.arc(player.x, player.y, radius, 0, Math.PI * 2); ctx.fill();
    }
    // Emblema do time: bandeira em SVG sobre o uniforme, com filete escuro.
    drawFlag(ctx, state.flags?.[player.team], player.x, player.y + 1, radius * 1.25);
    if (state.game === "haxball" && player.id === localPlayerId) {
      const barWidth = 42;
      ctx.fillStyle = "rgba(0,0,0,.8)";
      ctx.fillRect(player.x - barWidth / 2 - 2, player.y - radius - 31, barWidth + 4, 7);
      ctx.fillStyle = "#514038";
      ctx.fillRect(player.x - barWidth / 2, player.y - radius - 29, barWidth, 3);
      ctx.fillStyle = player.stamina < 25 ? "#fffdf9" : "#ffd166";
      ctx.fillRect(player.x - barWidth / 2, player.y - radius - 29, barWidth * clamp(player.stamina / 100, 0, 1), 3);
    }
    if (!opts.hideNames) {
      const nameCenterY = player.y - radius - (onIce ? 13 : 41);
      const name = labelSprite(player.name.slice(0, 12), "10px monospace", onIce ? "#111111" : "#ffffff");
      if (name) ctx.drawImage(name.img, player.x - name.w / 2, nameCenterY - name.h / 2, name.w, name.h);
    }
  }

  ctx.save();
  ctx.translate(state.ball.x, state.ball.y);
  if (state.game === "haxball") {
    ctx.rotate(state.ball.rotation ?? 0);
    ctx.beginPath(); ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#fffdf9"; ctx.fillRect(-BALL_RADIUS, -BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2);
    ctx.fillStyle = "#080808"; ctx.strokeStyle = "#080808"; ctx.lineWidth = 1;
    for (let point = 0; point < 5; point++) {
      const angle = -Math.PI / 2 + point * Math.PI * 2 / 5;
      const x = Math.cos(angle) * 3.7;
      const y = Math.sin(angle) * 3.7;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(Math.cos(angle) * 6, Math.sin(angle) * 6); ctx.stroke();
    }
    ctx.beginPath();
    for (let point = 0; point < 5; point++) {
      const angle = -Math.PI / 2 + point * Math.PI * 2 / 5;
      if (point === 0) ctx.moveTo(Math.cos(angle) * 3.7, Math.sin(angle) * 3.7);
      else ctx.lineTo(Math.cos(angle) * 3.7, Math.sin(angle) * 3.7);
    }
    ctx.closePath(); ctx.fill();
    for (let patch = 0; patch < 5; patch++) {
      const angle = -Math.PI / 2 + patch * Math.PI * 2 / 5;
      ctx.beginPath();
      for (const [radius, offset] of [[5.8, -0.27], [8.7, -0.29], [8.7, 0.29], [5.8, 0.27]]) {
        const x = Math.cos(angle + offset) * radius;
        const y = Math.sin(angle + offset) * radius;
        if (radius === 5.8 && offset < 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    }
  } else {
    ctx.beginPath(); ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#141414"; ctx.fill();
  }
  const ballFlash = state.ball.flash ?? 0;
  if (ballFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, (ballFlash / 0.18) * 0.6)})`;
    ctx.beginPath(); ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function pointerToField(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(canvas.width / 1160, canvas.height / VIEW_HEIGHT);
  const x = (clientX - bounds.left) * (canvas.width / bounds.width);
  const y = (clientY - bounds.top) * (canvas.height / bounds.height);
  return { x: clamp((x - canvas.width / 2) / scale, -1000, 1000), y: clamp((y - canvas.height / 2) / scale, -1000, 1000) };
}
