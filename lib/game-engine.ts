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
  bot: boolean;
  x: number;
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
}

export interface GameObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin?: number;
  rotation?: number;
}

export interface GameSnapshot {
  game: GameId;
  players: GameActor[];
  ball: GameObject;
  score: Record<GameTeam, number>;
  elapsed: number;
  freeze: number;
  winner: GameTeam | null;
  revision: number;
}

export interface BotCounts {
  blue: number;
  orange: number;
}

const FIELD_WIDTH = 1000;
const FIELD_HEIGHT = 560;
const VIEW_HEIGHT = 760;
const HALF_WIDTH = FIELD_WIDTH / 2;
const HALF_HEIGHT = FIELD_HEIGHT / 2;
const GOAL_DEPTH = { haxball: 70, hoquei: 42 };
const GOAL_HALF = { haxball: 85, hoquei: 62 } as Record<GameId, number>;
// Restituição da parede de campo (rebote vivo) vs. malha da rede (amortece).
const FIELD_RESTITUTION = { haxball: 0.72, hoquei: 0.92 } as Record<GameId, number>;
const NET_RESTITUTION = { haxball: 0.16, hoquei: 0.22 } as Record<GameId, number>;
const BALL_RADIUS = 11;
const emptyInput: GameInput = { x: 0, y: 0, sprint: false, kickSeq: 0, dashSeq: 0, aimX: 0, aimY: 0, power: 0, spin: false, kickSpin: false, charging: false };

interface Segment { x1: number; y1: number; x2: number; y2: number }

// Geometria física: a lateral tem abertura real para o gol; a bola rebate na
// rede e nas traves em vez de atravessar a borda.
function walls(game: GameId): Segment[] {
  const depth = GOAL_DEPTH[game];
  const goal = GOAL_HALF[game];
  return [
    { x1: -HALF_WIDTH - depth, y1: -HALF_HEIGHT, x2: HALF_WIDTH + depth, y2: -HALF_HEIGHT },
    { x1: -HALF_WIDTH - depth, y1: HALF_HEIGHT, x2: HALF_WIDTH + depth, y2: HALF_HEIGHT },
    { x1: -HALF_WIDTH, y1: -HALF_HEIGHT, x2: -HALF_WIDTH, y2: -goal },
    { x1: -HALF_WIDTH, y1: goal, x2: -HALF_WIDTH, y2: HALF_HEIGHT },
    { x1: HALF_WIDTH, y1: -HALF_HEIGHT, x2: HALF_WIDTH, y2: -goal },
    { x1: HALF_WIDTH, y1: goal, x2: HALF_WIDTH, y2: HALF_HEIGHT },
    { x1: -HALF_WIDTH - depth, y1: -goal, x2: -HALF_WIDTH - depth, y2: goal },
    { x1: -HALF_WIDTH - depth, y1: -goal, x2: -HALF_WIDTH, y2: -goal },
    { x1: -HALF_WIDTH - depth, y1: goal, x2: -HALF_WIDTH, y2: goal },
    { x1: HALF_WIDTH + depth, y1: -goal, x2: HALF_WIDTH + depth, y2: goal },
    { x1: HALF_WIDTH + depth, y1: -goal, x2: HALF_WIDTH, y2: -goal },
    { x1: HALF_WIDTH + depth, y1: goal, x2: HALF_WIDTH, y2: goal },
  ];
}

const FIELD_WALLS = { haxball: walls("haxball"), hoquei: walls("hoquei") };
// Primeiros 6 segmentos = contorno do campo; últimos 6 = caixas das redes.
const FIELD_BOUNDS = {
  haxball: FIELD_WALLS.haxball.slice(0, 6),
  hoquei: FIELD_WALLS.hoquei.slice(0, 6),
} as Record<GameId, Segment[]>;
const NET_WALLS = {
  haxball: FIELD_WALLS.haxball.slice(6),
  hoquei: FIELD_WALLS.hoquei.slice(6),
} as Record<GameId, Segment[]>;
const HAXBALL_NET_WALLS = NET_WALLS.haxball;

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

function ballInsideNet(ball: GameObject, game: GameId) {
  return Math.abs(ball.x) > HALF_WIDTH && Math.abs(ball.y) < GOAL_HALF[game];
}

// Tecido da rede: além do rebote fraco nas paredes da rede, o pano "segura" a
// bola com arrasto forte e mata o giro — por isso a bola morre no fundo em vez
// de voltar para o campo.
function applyNetDrag(ball: GameObject, game: GameId, sub: number) {
  if (!ballInsideNet(ball, game)) return;
  const drag = game === "haxball" ? 5.5 : 3.2;
  const keep = Math.max(0, 1 - drag * sub);
  ball.vx *= keep;
  ball.vy *= keep;
  if (ball.spin) {
    ball.spin *= Math.max(0, 1 - 6 * sub);
    if (Math.abs(ball.spin) < 0.05) ball.spin = 0;
  }
}

function keepBallInBounds(ball: GameObject, game: GameId) {
  const restitution = FIELD_RESTITUTION[game];
  const netRestitution = NET_RESTITUTION[game];
  if (ball.y < -HALF_HEIGHT + BALL_RADIUS) {
    ball.y = -HALF_HEIGHT + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * restitution;
  } else if (ball.y > HALF_HEIGHT - BALL_RADIUS) {
    ball.y = HALF_HEIGHT - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * restitution;
  }
  const goalClearance = GOAL_HALF[game] - BALL_RADIUS;
  if (Math.abs(ball.y) >= goalClearance) {
    if (ball.x < -HALF_WIDTH + BALL_RADIUS) {
      ball.x = -HALF_WIDTH + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx) * restitution;
    } else if (ball.x > HALF_WIDTH - BALL_RADIUS) {
      ball.x = HALF_WIDTH - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx) * restitution;
    }
  } else {
    // Fundo da rede. Quem não é o host só congela quando o snapshot do host
    // traz o gelo do gol (até ~80 ms depois), então sem este limite a bola
    // atravessaria o gol e sairia de campo nesse intervalo.
    const back = HALF_WIDTH + GOAL_DEPTH[game] - BALL_RADIUS;
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

function positionFor(team: GameTeam, index: number, game: GameId) {
  const direction = team === "blue" ? -1 : 1;
  if (game === "hoquei") return { x: direction * 270, y: 0 };
  const offsets = [-120, 120, 0, -220, 220];
  return { x: direction * (200 + (index % 2) * 95), y: offsets[index % offsets.length] };
}

function actor(id: string, name: string, team: GameTeam, index: number, game: GameId, bot: boolean): GameActor {
  const position = positionFor(team, index, game);
  const facingX = team === "blue" ? 1 : -1;
  return {
    id, name, team, bot, ...position, vx: 0, vy: 0, cooldown: 0,
    stamina: 100, sprintLock: false, sprintRest: 0,
    facingX, facingY: 0, aimX: position.x + facingX * 180,
    aimY: position.y, charge: 0, curve: false,
    dashCooldown: 0, dashRemaining: 0, dashX: 0, dashY: 0, lastDashSeq: 0,
  };
}

export function createBotGame(game: GameId, bots: BotCounts): GameSnapshot {
  const players = [actor("local", "VOCÊ", "blue", 0, game, false)];
  if (game === "haxball") {
    for (let index = 0; index < clamp(bots.blue, 0, 4); index++) {
      players.push(actor(`bot-blue-${index}`, `BOT ${index + 1}`, "blue", index + 1, game, true));
    }
    for (let index = 0; index < clamp(bots.orange, 1, 5); index++) {
      players.push(actor(`bot-orange-${index}`, `BOT ${index + 1}`, "orange", index, game, true));
    }
  } else {
    players.push(actor("bot-orange-0", "BOT", "orange", 0, game, true));
  }
  return { game, players, ball: { x: 0, y: 0, vx: 0, vy: 0, rotation: 0 }, score: { blue: 0, orange: 0 }, elapsed: 0, freeze: 0, winner: null, revision: 0 };
}

export function createOnlineGame(game: GameId, roster: GameRoomPlayer[]): GameSnapshot {
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  const players = roster.map((player) => actor(player.id, player.name, player.team, indexes[player.team]++, game, false));
  return { game, players, ball: { x: 0, y: 0, vx: 0, vy: 0, rotation: 0 }, score: { blue: 0, orange: 0 }, elapsed: 0, freeze: 0, winner: null, revision: 0 };
}

export function updateOnlineRoster(state: GameSnapshot, roster: GameRoomPlayer[]) {
  const known = new Map(state.players.map((player) => [player.id, player]));
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  state.players = roster.map((player) => {
    const index = indexes[player.team]++;
    const existing = known.get(player.id);
    return existing && existing.team === player.team
      ? { ...existing, name: player.name }
      : actor(player.id, player.name, player.team, index, state.game, false);
  });
}

function resetPositions(state: GameSnapshot) {
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  state.players.forEach((player) => {
    const position = positionFor(player.team, indexes[player.team]++, state.game);
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

function keepPlayerInBounds(player: GameActor, game: GameId) {
  const radius = game === "haxball" ? 16 : 24;
  const margin = game === "haxball" ? 46 : 0;
  player.y = clamp(player.y, -HALF_HEIGHT - margin + radius, HALF_HEIGHT + margin - radius);
  if (game === "hoquei") {
    player.x = player.team === "blue"
      ? clamp(player.x, -HALF_WIDTH + radius, -radius - 4)
      : clamp(player.x, radius + 4, HALF_WIDTH - radius);
  } else {
    player.x = clamp(player.x, -HALF_WIDTH - margin + radius, HALF_WIDTH + margin - radius);
    for (let i = 0; i < HAXBALL_NET_WALLS.length; i++) collideCircleSegment(player, radius, HAXBALL_NET_WALLS[i], 0.25);
  }
}

function steer(player: GameActor, input: GameInput, dt: number, game: GameId) {
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
      if (player.sprintRest > 0.5) player.stamina = Math.min(100, player.stamina + 20 * dt);
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
      const dx = input.aimX - player.x;
      const dy = input.aimY - player.y;
      const aimLength = Math.sqrt(dx * dx + dy * dy);
      if (player.stamina >= 28 && player.dashCooldown === 0 && aimLength > 3) {
        player.stamina -= 28;
        player.sprintRest = 0;
        player.dashCooldown = 1.2;
        player.dashRemaining = 0.13;
        player.dashX = dx / aimLength;
        player.dashY = dy / aimLength;
        if (player.stamina === 0) player.sprintLock = true;
      }
    }
  }
  const dashing = game === "haxball" && player.dashRemaining > 0;
  const max = game === "haxball" ? (dashing ? 300 : player.bot ? 120 : sprinting ? 165 : 120) : 260;
  if (dashing) {
    player.vx = player.dashX * max;
    player.vy = player.dashY * max;
    player.dashRemaining = Math.max(0, player.dashRemaining - dt);
  } else {
    const reversing = ix * player.vx + iy * player.vy < -1;
    const acceleration = game === "haxball" ? (reversing ? 1500 : 1100) : 2200;
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
  keepPlayerInBounds(player, game);
  player.cooldown = Math.max(0, player.cooldown - dt);
}

function botInput(player: GameActor, state: GameSnapshot): GameInput {
  const ball = state.ball;
  if (state.game === "hoquei") {
    const side = player.team === "blue" ? -1 : 1;
    const ownGoalX = side * HALF_WIDTH;
    const approaching = ball.vx * side > 40;
    const inOwnHalf = ball.x * side > 0;
    const defenseX = side * (HALF_WIDTH - 82);
    const travel = approaching ? clamp((defenseX - ball.x) / (ball.vx || 1), 0, 0.75) : 0.16;
    const predictedY = reflectedPuckY(ball.y + ball.vy * travel);
    const danger = inOwnHalf || (approaching && Math.abs(ball.x - ownGoalX) < 600);
    const targetX = approaching && Math.abs(ball.vx) > 200 && Math.abs(ball.x - defenseX) > 95
      ? defenseX
      : danger ? clamp(ball.x + side * 38, -HALF_WIDTH + 27, HALF_WIDTH - 27) : defenseX;
    const ownHalfX = side < 0 ? clamp(targetX, -HALF_WIDTH + 27, -28) : clamp(targetX, 28, HALF_WIDTH - 27);
    const targetY = danger ? predictedY : clamp(predictedY * 0.55, -140, 140);
    // A frenagem considera a velocidade atual para evitar oscilações perto do disco.
    const dx = ownHalfX - player.x - player.vx * 0.085;
    const dy = targetY - player.y - player.vy * 0.085;
    return { ...emptyInput, x: Math.abs(dx) < 5 ? 0 : clamp(dx / 62, -1, 1), y: Math.abs(dy) < 5 ? 0 : clamp(dy / 62, -1, 1) };
  }
  const targetX = ball.x + (player.team === "blue" ? -32 : 32);
  const sameTeam = state.players.filter((other) => other.team === player.team);
  const rank = sameTeam.indexOf(player);
  const targetY = ball.y + (rank % 2 === 0 ? -1 : 1) * Math.floor(rank / 2) * 48;
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const distanceSq = dx * dx + dy * dy;
  return {
    ...emptyInput,
    x: distanceSq > 64 ? clamp(dx / 80, -1, 1) : 0,
    y: distanceSq > 64 ? clamp(dy / 80, -1, 1) : 0,
    aimX: player.team === "blue" ? HALF_WIDTH : -HALF_WIDTH,
    aimY: clamp(ball.y * 0.2 + Math.sin(state.elapsed * 2.1 + player.x * 0.03) * 34, -65, 65),
    power: botShotPower(player, state),
  };
}

export function botShotPower(player: GameActor, state: GameSnapshot) {
  const distance = Math.abs((player.team === "blue" ? HALF_WIDTH : -HALF_WIDTH) - state.ball.x);
  const variation = (Math.sin(state.elapsed * 3.7 + player.id.length * 1.9 + player.y * 0.02) + 1) / 2;
  return clamp(0.3 + 0.22 * (distance / FIELD_WIDTH) + 0.22 * variation, 0.3, 0.74);
}

function reflectedPuckY(y: number) {
  const edge = HALF_HEIGHT - 11;
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

function collideCircles(a: GameObject, b: GameObject, radiusA: number, radiusB: number, massA: number, massB: number, restitution: number, ballBoostAmount = 0) {
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
}

function kick(state: GameSnapshot, player: GameActor, input: GameInput) {
  if (player.cooldown > 0 || state.freeze > 0) return;
  const ball = state.ball;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  if (dx * dx + dy * dy > 41 * 41) return;
  const direction = resolveKickDirection(player, ball, input.aimX, input.aimY);
  if (!direction) return;
  const speed = 680 * (0.35 + 0.65 * clamp(input.power, 0, 1));
  ball.vx = direction.x * speed + player.vx * 0.35;
  ball.vy = direction.y * speed + player.vy * 0.35;
  ball.spin = input.kickSpin ? 8 : (ball.spin ?? 0) * 0.3;
  player.cooldown = 0.45;
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
   * a linha inteira, mas não marca nem gela — quem chama aplica o placar com
   * `applyGoal()` depois do replay (rede 1s → replay → placar).
   */
  deferGoal?: boolean;
  onGoal?: (team: GameTeam) => void;
}

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
  const isHaxball = state.game === "haxball";
  const bounds = FIELD_BOUNDS[state.game];
  const nets = NET_WALLS[state.game];
  const fieldRest = FIELD_RESTITUTION[state.game];
  const netRest = NET_RESTITUTION[state.game];
  const goalHalf = GOAL_HALF[state.game];
  const friction = isHaxball ? 0.7 : 0.45;
  const stopSq = isHaxball ? 64 : 36;
  const max = isHaxball ? 1000 : 1050;
  const playerRadius = isHaxball ? 16 : 24;
  const playerMass = isHaxball ? 3 : 6;
  // Encostar no corpo não dispara a bola: restituição e impulso baixos.
  const playerRest = isHaxball ? 0.5 : 0.95;
  const touchBoost = isHaxball ? 0.1 : 0.18;

  // Amostra os inputs uma vez por tick (não por substep): corta ~3x o custo da
  // IA e o lixo de objetos sem mudar o comportamento em 16 ms.
  const tickInputs: Record<string, GameInput> = {};
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    tickInputs[player.id] = player.bot ? botInput(player, state) : (inputs[player.id] ?? emptyInput);
  }

  const steps = 3;
  for (let step = 0; step < steps; step++) {
    const sub = delta / steps;
    for (let i = 0; i < state.players.length; i++) {
      const player = state.players[i];
      const input = tickInputs[player.id];
      steer(player, input, sub, state.game);
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
    applyNetDrag(ball, state.game, sub);
    if (ball.vx * ball.vx + ball.vy * ball.vy < stopSq) { ball.vx = 0; ball.vy = 0; }
    ball.x += ball.vx * sub;
    ball.y += ball.vy * sub;
    if (isHaxball) ball.rotation = (ball.rotation ?? 0) + ((ball.vx * 0.25 + ball.vy * 0.2) / 11 + (ball.spin ?? 0) * 1.5) * sub;
    // Contorno com rebote vivo, rede com rebote morto (tecido).
    for (let i = 0; i < bounds.length; i++) collideCircleSegment(ball, BALL_RADIUS, bounds[i], fieldRest);
    for (let i = 0; i < nets.length; i++) collideCircleSegment(ball, BALL_RADIUS, nets[i], netRest);
    keepBallInBounds(ball, state.game);
    if (isHaxball) {
      for (const x of [-HALF_WIDTH, HALF_WIDTH]) {
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
      collideCircles(player, ball, playerRadius, BALL_RADIUS, playerMass, 1, playerRest, touchBoost);
      keepPlayerInBounds(player, state.game);
    }
    for (let i = 0; i < bounds.length; i++) collideCircleSegment(ball, BALL_RADIUS, bounds[i], fieldRest);
    for (let i = 0; i < nets.length; i++) collideCircleSegment(ball, BALL_RADIUS, nets[i], netRest);
    keepBallInBounds(ball, state.game);
    const ballSpeedSq = ball.vx * ball.vx + ball.vy * ball.vy;
    if (ballSpeedSq > max * max) {
      const scale = max / Math.sqrt(ballSpeedSq);
      ball.vx *= scale;
      ball.vy *= scale;
    }
    const goalThreshold = HALF_WIDTH + (isHaxball ? 11 : 4);
    if (ball.x < -goalThreshold && Math.abs(ball.y) < goalHalf - 11) {
      if (authoritative) {
        if (options.deferGoal) options.onGoal?.("orange");
        else scoreGoal(state, "orange");
      }
      break;
    }
    if (ball.x > goalThreshold && Math.abs(ball.y) < goalHalf - 11) {
      if (authoritative) {
        if (options.deferGoal) options.onGoal?.("blue");
        else scoreGoal(state, "blue");
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
 * remotos que chegam em intervalos de rede — a deriva em relação ao host é
 * inevitável. Em vez de trocar o estado inteiro a cada snapshot (o que faria o
 * jogo "pular" na taxa de rede), posições e velocidades convergem
 * exponencialmente para o alvo e apenas divergências grandes (gol, reset de
 * posições) aplicam snap instantâneo.
 *
 * Estado discreto — placar, gelo, vencedor e elenco — é sempre do host, e o
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
  // (local.elapsed - target.elapsed ≈ latência). Extrapolar a bola pela própria
  // velocidade nesse intervalo faz o convidado ver a bola no presente, e não
  // onde ela estava quando o host publicou — é o que mata a sensação de lag.
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

function netBulge(ball: GameObject, side: -1 | 1): number {
  if (Math.sign(ball.x) !== side || Math.abs(ball.x) <= HALF_WIDTH) return 0;
  const depth = GOAL_DEPTH.haxball;
  return clamp((Math.abs(ball.x) - HALF_WIDTH) / depth, 0, 1) * 14;
}

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

function paintHaxballStatic(ctx: CanvasRenderingContext2D) {
  // Entorno escuro + gramado com listras de corte (mow stripes).
  ctx.fillStyle = "#0d1a0f";
  ctx.fillRect(-HALF_WIDTH - 130, -HALF_HEIGHT - 130, FIELD_WIDTH + 260, FIELD_HEIGHT + 260);
  const stripes = 10;
  const stripeW = FIELD_WIDTH / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#2f9e44" : "#2a9140";
    ctx.fillRect(-HALF_WIDTH + i * stripeW, -HALF_HEIGHT, stripeW + 0.5, FIELD_HEIGHT);
  }
  // Textura de grama: milhares de fios determinísticos (LCG com seed fixa —
  // o campo redesenha igual a cada resize, sem cintilar).
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 4200; i++) {
    const x = -HALF_WIDTH + rand() * FIELD_WIDTH;
    const y = -HALF_HEIGHT + rand() * FIELD_HEIGHT;
    ctx.fillStyle = rand() > 0.5 ? "rgba(18,84,32,0.12)" : "rgba(130,225,145,0.09)";
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 1.5);
  }
  // Brilho sutil de cima para dar volume sem tirar o fosco do gramado.
  const sheen = ctx.createLinearGradient(0, -HALF_HEIGHT, 0, HALF_HEIGHT);
  sheen.addColorStop(0, "rgba(255,255,255,0.06)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.10)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);

  // Marcações brancas oficiais: contorno, meio-campo, círculo central, áreas.
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.strokeRect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);
  ctx.beginPath();
  ctx.moveTo(0, -HALF_HEIGHT);
  ctx.lineTo(0, HALF_HEIGHT);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 75, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  // Áreas: grande (140 x 320) e pequena (55 x 190) + marcas de pênalti + arcos.
  for (const side of [-1, 1] as const) {
    const gx = side * HALF_WIDTH;
    const bigX = side < 0 ? gx : gx - 140;
    const smallX = side < 0 ? gx : gx - 55;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(bigX, -160, 140, 320);
    ctx.strokeRect(smallX, -95, 55, 190);
    const spotX = side * (HALF_WIDTH - 105);
    ctx.beginPath();
    ctx.arc(spotX, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // Meia-lua: termina exatamente na linha da área (105 + 52·cos θ = 140),
    // então o traço nunca cruza nem vaza para dentro da área.
    const arcHalf = Math.acos(35 / 52);
    ctx.beginPath();
    if (side < 0) ctx.arc(spotX, 0, 52, -arcHalf, arcHalf);
    else ctx.arc(spotX, 0, 52, Math.PI - arcHalf, Math.PI + arcHalf);
    ctx.stroke();
  }
  // Escanteios: só o quarto de círculo voltado para dentro do campo.
  ctx.lineWidth = 3;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const mid = Math.atan2(-sy, -sx);
      ctx.beginPath();
      ctx.arc(sx * HALF_WIDTH, sy * HALF_HEIGHT, 14, mid - Math.PI / 4, mid + Math.PI / 4);
      ctx.stroke();
    }
  }

  // Redes chapadas na camada estática; a barriga do pano é redesenhada por
  // cima a cada frame só enquanto a bola está na rede (ver drawGame).
  const goalHalf = GOAL_HALF.haxball;
  const depth = GOAL_DEPTH.haxball;
  drawNetMesh(ctx, -HALF_WIDTH - depth, -goalHalf, depth, goalHalf * 2, 0, true);
  drawNetMesh(ctx, HALF_WIDTH, -goalHalf, depth, goalHalf * 2, 0, false);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.strokeRect(-HALF_WIDTH - depth, -goalHalf, depth, goalHalf * 2);
  ctx.strokeRect(HALF_WIDTH, -goalHalf, depth, goalHalf * 2);

  // Traves e travessões internos.
  for (const x of [-HALF_WIDTH, HALF_WIDTH]) {
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

function paintHockeyStatic(ctx: CanvasRenderingContext2D) {
  const RED = "rgba(200,16,46,0.55)";
  const RED_SOLID = "rgba(200,16,46,0.8)";
  const BLUE = "rgba(11,61,145,0.6)";
  const BLUE_SOLID = "rgba(11,61,145,0.85)";
  const BLACK = "rgba(17,17,17,0.6)";
  const ICE = "#edf0f2";
  // Gelo fosco: chapado, sem gradiente brilhante.
  ctx.fillStyle = "#101418";
  ctx.fillRect(-HALF_WIDTH - 90, -HALF_HEIGHT - 90, FIELD_WIDTH + 180, FIELD_HEIGHT + 180);
  ctx.fillStyle = ICE;
  ctx.fillRect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);
  // Reflexo quase imperceptível do gelo (mantém o fosco).
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, 26);

  // Tabelas: contorno preto + rodapé amarelo (kickplate).
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 10;
  ctx.strokeRect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);
  ctx.strokeStyle = "#e8b921";
  ctx.lineWidth = 5;
  ctx.strokeRect(-HALF_WIDTH + 8, -HALF_HEIGHT + 8, FIELD_WIDTH - 16, FIELD_HEIGHT - 16);

  // Linha central vermelha + círculo central azul.
  ctx.fillStyle = RED;
  ctx.fillRect(-6, -HALF_HEIGHT, 12, FIELD_HEIGHT);
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
  for (const x of [-160, 160]) ctx.fillRect(x - 8, -HALF_HEIGHT, 16, FIELD_HEIGHT);

  // Linhas de gol coladas no fundo + crease em frente à boca do gol.
  // O crease é recortado no retângulo do rinque: a tinta passa por baixo da
  // rede sem vazar para fora das tabelas.
  ctx.fillStyle = RED;
  for (const x of [-492, 492]) ctx.fillRect(x - 2, -HALF_HEIGHT, 4, FIELD_HEIGHT);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);
  ctx.clip();
  for (const side of [-1, 1] as const) {
    const cx = side * (HALF_WIDTH - 20);
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
  const spots: Array<[number, number]> = [[-300, -160], [-300, 160], [300, -160], [300, 160]];
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
  for (const [fx, fy] of [[-90, -160], [-90, 160], [90, -160], [90, 160]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.arc(fx, fy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Redes do hóquei: armação vermelha + malha branca.
  const goalHalf = GOAL_HALF.hoquei;
  const depth = GOAL_DEPTH.hoquei;
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? -HALF_WIDTH - depth : HALF_WIDTH;
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
      ctx.arc(side * HALF_WIDTH, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Camada estática do campo: pintada uma vez por (jogo × tamanho) e copiada
// com um único drawImage por frame. É o que tira o render de ~400 operações
// vetoriais por frame para ~40 — o ganho que leva o FPS de volta aos 60+.
const fieldLayers = new Map<string, HTMLCanvasElement>();

function fieldLayer(game: GameId, w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${game}-${w}x${h}`;
  const cached = fieldLayers.get(key);
  if (cached) return cached;
  if (fieldLayers.size >= 4) {
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
  if (game === "haxball") paintHaxballStatic(g);
  else paintHockeyStatic(g);
  fieldLayers.set(key, layer);
  return layer;
}

export function drawGame(ctx: CanvasRenderingContext2D, state: GameSnapshot, localPlayerId: string) {
  const { width, height } = ctx.canvas;
  const scale = Math.min(width / 1160, height / VIEW_HEIGHT);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = state.game === "haxball" ? "#0d1a0f" : "#101418";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);

  const layer = fieldLayer(state.game, width, height);
  if (layer) ctx.drawImage(layer, -580, -380, 1160, 760);
  else if (state.game === "haxball") paintHaxballStatic(ctx);
  else paintHockeyStatic(ctx);

  // Barriga da rede: só a rede ocupada é redesenhada por cima, e só enquanto
  // a bola está no pano.
  if (state.game === "haxball"
    && Math.abs(state.ball.x) > HALF_WIDTH
    && Math.abs(state.ball.y) < GOAL_HALF.haxball) {
    const side = state.ball.x > 0 ? 1 : -1;
    const depth = GOAL_DEPTH.haxball;
    const goalHalf = GOAL_HALF.haxball;
    const bulge = netBulge(state.ball, side as -1 | 1);
    const x = side < 0 ? -HALF_WIDTH - depth - bulge : HALF_WIDTH;
    drawNetMesh(ctx, x, -goalHalf, depth + bulge, goalHalf * 2, bulge, side < 0);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, -goalHalf, depth + bulge, goalHalf * 2);
  }

  const onIce = state.game === "hoquei";
  for (const player of state.players) {
    const radius = onIce ? 24 : 16;
    ctx.beginPath(); ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = player.team === "blue" ? "#fffdf9" : "#ff8d4f"; ctx.fill();
    if (player.id === localPlayerId) {
      ctx.beginPath(); ctx.arc(player.x, player.y, radius + 4, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = onIce ? "#0b3d91" : "#ffd166"; ctx.stroke();
    }
    ctx.fillStyle = player.team === "blue" ? "#050505" : "#120c08";
    ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(player.bot ? "B" : "P", player.x, player.y + 1);
    if (state.game === "haxball" && player.id === localPlayerId) {
      const barWidth = 42;
      ctx.fillStyle = "rgba(0,0,0,.8)";
      ctx.fillRect(player.x - barWidth / 2 - 2, player.y - radius - 31, barWidth + 4, 7);
      ctx.fillStyle = "#514038";
      ctx.fillRect(player.x - barWidth / 2, player.y - radius - 29, barWidth, 3);
      ctx.fillStyle = player.stamina < 25 ? "#fffdf9" : "#ffd166";
      ctx.fillRect(player.x - barWidth / 2, player.y - radius - 29, barWidth * clamp(player.stamina / 100, 0, 1), 3);
    }
    ctx.fillStyle = onIce ? "#111111" : "#ffffff";
    ctx.font = "10px monospace";
    ctx.fillText(player.name.slice(0, 12), player.x, player.y - radius - (onIce ? 13 : 41));
  }

  ctx.save();
  ctx.translate(state.ball.x, state.ball.y);
  if (state.game === "haxball") {
    ctx.rotate(state.ball.rotation ?? 0);
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#fffdf9"; ctx.fillRect(-11, -11, 22, 22);
    ctx.fillStyle = "#080808"; ctx.strokeStyle = "#080808"; ctx.lineWidth = 1;
    for (let point = 0; point < 5; point++) {
      const angle = -Math.PI / 2 + point * Math.PI * 2 / 5;
      const x = Math.cos(angle) * 5.1;
      const y = Math.sin(angle) * 5.1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(Math.cos(angle) * 8.2, Math.sin(angle) * 8.2); ctx.stroke();
    }
    ctx.beginPath();
    for (let point = 0; point < 5; point++) {
      const angle = -Math.PI / 2 + point * Math.PI * 2 / 5;
      if (point === 0) ctx.moveTo(Math.cos(angle) * 5.1, Math.sin(angle) * 5.1);
      else ctx.lineTo(Math.cos(angle) * 5.1, Math.sin(angle) * 5.1);
    }
    ctx.closePath(); ctx.fill();
    for (let patch = 0; patch < 5; patch++) {
      const angle = -Math.PI / 2 + patch * Math.PI * 2 / 5;
      ctx.beginPath();
      for (const [radius, offset] of [[8, -0.27], [12, -0.29], [12, 0.29], [8, 0.27]]) {
        const x = Math.cos(angle + offset) * radius;
        const y = Math.sin(angle + offset) * radius;
        if (radius === 8 && offset < 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    }
  } else {
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#141414"; ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

export function pointerToField(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(canvas.width / 1160, canvas.height / VIEW_HEIGHT);
  const x = (clientX - bounds.left) * (canvas.width / bounds.width);
  const y = (clientY - bounds.top) * (canvas.height / bounds.height);
  return { x: clamp((x - canvas.width / 2) / scale, -1000, 1000), y: clamp((y - canvas.height / 2) / scale, -1000, 1000) };
}
