import type { GameId, GameRoomPlayer, GameTeam } from "@/lib/games";

export interface GameInput {
  x: number;
  y: number;
  sprint: boolean;
  kickSeq: number;
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
}

export interface GameObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin?: number;
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
const emptyInput: GameInput = { x: 0, y: 0, sprint: false, kickSeq: 0, aimX: 0, aimY: 0, power: 0, spin: false, kickSpin: false, charging: false };

interface Segment { x1: number; y1: number; x2: number; y2: number }

// Mantém a geometria física dos exemplos: a lateral tem uma abertura real
// para o gol, e a bola rebate na rede e nas traves em vez de atravessar a borda.
function walls(game: GameId): Segment[] {
  const depth = GOAL_DEPTH[game];
  const goal = game === "haxball" ? 85 : 62;
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
const HAXBALL_NET_WALLS = FIELD_WALLS.haxball.slice(6);

function collideCircleSegment(circle: GameObject, radius: number, segment: Segment, restitution: number) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const fraction = clamp(((circle.x - segment.x1) * dx + (circle.y - segment.y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  const px = segment.x1 + dx * fraction;
  const py = segment.y1 + dy * fraction;
  let nx = circle.x - px;
  let ny = circle.y - py;
  const distance = Math.hypot(nx, ny);
  if (distance >= radius || distance === 0) return;
  nx /= distance; ny /= distance;
  circle.x = px + nx * radius;
  circle.y = py + ny * radius;
  const velocity = circle.vx * nx + circle.vy * ny;
  if (velocity < 0) {
    circle.vx -= (1 + restitution) * velocity * nx;
    circle.vy -= (1 + restitution) * velocity * ny;
  }
}

function collidePost(circle: GameObject, radius: number, x: number, y: number) {
  const dx = circle.x - x;
  const dy = circle.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius + 7 || distance === 0) return;
  const nx = dx / distance;
  const ny = dy / distance;
  circle.x = x + nx * (radius + 7);
  circle.y = y + ny * (radius + 7);
  const velocity = circle.vx * nx + circle.vy * ny;
  if (velocity < 0) {
    circle.vx -= 1.85 * velocity * nx;
    circle.vy -= 1.85 * velocity * ny;
  }
}

function keepBallInBounds(ball: GameObject, game: GameId) {
  const restitution = game === "haxball" ? 0.72 : 0.92;
  if (ball.y < -HALF_HEIGHT + 11) {
    ball.y = -HALF_HEIGHT + 11;
    ball.vy = Math.abs(ball.vy) * restitution;
  } else if (ball.y > HALF_HEIGHT - 11) {
    ball.y = HALF_HEIGHT - 11;
    ball.vy = -Math.abs(ball.vy) * restitution;
  }
  const goalClearance = (game === "haxball" ? 85 : 62) - 11;
  if (Math.abs(ball.y) >= goalClearance) {
    if (ball.x < -HALF_WIDTH + 11) {
      ball.x = -HALF_WIDTH + 11;
      ball.vx = Math.abs(ball.vx) * restitution;
    } else if (ball.x > HALF_WIDTH - 11) {
      ball.x = HALF_WIDTH - 11;
      ball.vx = -Math.abs(ball.vx) * restitution;
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
  return { game, players, ball: { x: 0, y: 0, vx: 0, vy: 0 }, score: { blue: 0, orange: 0 }, elapsed: 0, freeze: 0, winner: null, revision: 0 };
}

export function createOnlineGame(game: GameId, roster: GameRoomPlayer[]): GameSnapshot {
  const indexes: Record<GameTeam, number> = { blue: 0, orange: 0 };
  const players = roster.map((player) => actor(player.id, player.name, player.team, indexes[player.team]++, game, false));
  return { game, players, ball: { x: 0, y: 0, vx: 0, vy: 0 }, score: { blue: 0, orange: 0 }, elapsed: 0, freeze: 0, winner: null, revision: 0 };
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
  });
  state.ball = { x: 0, y: 0, vx: 0, vy: 0 };
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
    for (const segment of HAXBALL_NET_WALLS) collideCircleSegment(player, radius, segment, 0.25);
  }
}

function steer(player: GameActor, input: GameInput, dt: number, game: GameId) {
  const length = Math.hypot(input.x, input.y) || 1;
  let sprinting = false;
  if (game === "haxball" && !player.bot) {
    sprinting = input.sprint && (input.x !== 0 || input.y !== 0) && !player.sprintLock && player.stamina > 0;
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
      const aimLength = Math.hypot(input.aimX - player.x, input.aimY - player.y);
      if (aimLength > 1) {
        player.facingX = (input.aimX - player.x) / aimLength;
        player.facingY = (input.aimY - player.y) / aimLength;
      }
      player.aimX = input.aimX;
      player.aimY = input.aimY;
      player.charge = clamp(input.power, 0, 1);
      player.curve = input.spin;
    } else {
      player.charge = 0;
      player.curve = false;
    }
  }
  const max = game === "haxball" ? (player.bot ? 160 : sprinting ? 250 : 190) : 540;
  const acceleration = game === "haxball" ? 2000 : 5600;
  player.vx += (input.x / length) * acceleration * dt;
  player.vy += (input.y / length) * acceleration * dt;
  if (!input.x && !input.y) {
    const drag = Math.max(0, 1 - (game === "haxball" ? 9 : 10) * dt);
    player.vx *= drag;
    player.vy *= drag;
  }
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > max) {
    player.vx *= max / speed;
    player.vy *= max / speed;
  }
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  keepPlayerInBounds(player, game);
  player.cooldown = Math.max(0, player.cooldown - dt);
}

function botInput(player: GameActor, state: GameSnapshot): GameInput {
  const ball = state.ball;
  if (state.game === "hoquei") {
    const targetX = player.team === "blue"
      ? clamp(ball.x - 55, -HALF_WIDTH + 30, -30)
      : clamp(ball.x + 55, 30, HALF_WIDTH - 30);
    const targetY = clamp(ball.y + ball.vy * 0.16, -HALF_HEIGHT + 30, HALF_HEIGHT - 30);
    return { ...emptyInput, x: clamp((targetX - player.x) / 70, -1, 1), y: clamp((targetY - player.y) / 70, -1, 1) };
  }
  const targetX = ball.x + (player.team === "blue" ? -32 : 32);
  const sameTeam = state.players.filter((other) => other.team === player.team);
  const rank = sameTeam.indexOf(player);
  const targetY = ball.y + (rank % 2 === 0 ? -1 : 1) * Math.floor(rank / 2) * 48;
  const distance = Math.hypot(targetX - player.x, targetY - player.y);
  return {
    ...emptyInput,
    x: distance > 8 ? clamp((targetX - player.x) / 80, -1, 1) : 0,
    y: distance > 8 ? clamp((targetY - player.y) / 80, -1, 1) : 0,
    aimX: player.team === "blue" ? HALF_WIDTH : -HALF_WIDTH,
    aimY: clamp(ball.y * 0.25, -80, 80),
    power: 0.75,
  };
}

function collideCircles(a: GameObject, b: GameObject, radiusA: number, radiusB: number, massA: number, massB: number, restitution: number, ballBoost = false) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const minimum = radiusA + radiusB;
  if (distance >= minimum) return;
  const nx = distance > 0.001 ? dx / distance : 1;
  const ny = distance > 0.001 ? dy / distance : 0;
  const overlap = minimum - distance;
  const total = massA + massB;
  a.x -= nx * overlap * (massB / total);
  a.y -= ny * overlap * (massB / total);
  b.x += nx * overlap * (massA / total);
  b.y += ny * overlap * (massA / total);
  const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relative >= 0) return;
  const impulse = -(1 + restitution) * relative / (1 / massA + 1 / massB);
  a.vx -= impulse / massA * nx;
  a.vy -= impulse / massA * ny;
  b.vx += impulse / massB * nx;
  b.vy += impulse / massB * ny;
  if (ballBoost) {
    b.vx += a.vx * 0.18;
    b.vy += a.vy * 0.18;
  }
}

function kick(state: GameSnapshot, player: GameActor, input: GameInput) {
  if (player.cooldown > 0 || state.freeze > 0) return;
  const ball = state.ball;
  if (Math.hypot(ball.x - player.x, ball.y - player.y) > 16 + 11 + 14) return;
  const dx = input.aimX - player.x;
  const dy = input.aimY - player.y;
  const length = Math.hypot(dx, dy) || 1;
  const forward = ((ball.x - player.x) * dx + (ball.y - player.y) * dy) / (length * (Math.hypot(ball.x - player.x, ball.y - player.y) || 1));
  if (forward < 0.3) return;
  const speed = 850 * (0.35 + 0.65 * clamp(input.power, 0, 1));
  ball.vx = (dx / length) * speed + player.vx * 0.35;
  ball.vy = (dy / length) * speed + player.vy * 0.35;
  ball.spin = input.kickSpin ? 8 : (ball.spin ?? 0) * 0.3;
  player.cooldown = 0.45;
}

export function stepGame(state: GameSnapshot, inputs: Record<string, GameInput>, lastKicks: Record<string, number>, dt: number) {
  if (state.winner) return;
  const delta = clamp(dt, 0, 0.05);
  if (state.freeze > 0) {
    state.freeze -= delta;
    if (state.freeze <= 0) resetPositions(state);
    return;
  }
  state.elapsed += delta;
  const steps = 3;
  for (let step = 0; step < steps; step++) {
    const sub = delta / steps;
    for (const player of state.players) {
      const input = player.bot ? botInput(player, state) : (inputs[player.id] ?? emptyInput);
      steer(player, input, sub, state.game);
      if (state.game === "haxball") {
        if (player.bot && Math.hypot(state.ball.x - player.x, state.ball.y - player.y) < 48) kick(state, player, input);
        if (!player.bot && input.kickSeq > (lastKicks[player.id] ?? 0)) {
          lastKicks[player.id] = input.kickSeq;
          kick(state, player, input);
        }
      }
    }

    const ball = state.ball;
    const friction = state.game === "haxball" ? 0.7 : 0.45;
    ball.vx *= Math.max(0, 1 - friction * sub);
    ball.vy *= Math.max(0, 1 - friction * sub);
    if (state.game === "haxball" && ball.spin) {
      const ballSpeed = Math.hypot(ball.vx, ball.vy);
      if (ballSpeed > 20) {
        ball.vx += (-ball.vy / ballSpeed) * ball.spin * 42 * sub;
        ball.vy += (ball.vx / ballSpeed) * ball.spin * 42 * sub;
      }
      ball.spin *= Math.max(0, 1 - 1.1 * sub);
      if (Math.abs(ball.spin) < 0.05) ball.spin = 0;
    }
    if (Math.hypot(ball.vx, ball.vy) < (state.game === "haxball" ? 8 : 6)) { ball.vx = 0; ball.vy = 0; }
    ball.x += ball.vx * sub;
    ball.y += ball.vy * sub;
    const max = state.game === "haxball" ? 1000 : 1050;
    for (const segment of FIELD_WALLS[state.game]) collideCircleSegment(ball, 11, segment, state.game === "haxball" ? 0.72 : 0.92);
    keepBallInBounds(ball, state.game);
    const goalHalf = state.game === "haxball" ? 85 : 62;
    if (state.game === "haxball") {
      for (const x of [-HALF_WIDTH, HALF_WIDTH]) {
        for (const y of [-goalHalf, goalHalf]) collidePost(ball, 11, x, y);
      }
    }
    if (state.game === "haxball") {
      for (let first = 0; first < state.players.length; first++) {
        for (let second = first + 1; second < state.players.length; second++) {
          collideCircles(state.players[first], state.players[second], 16, 16, 3, 3, 0.4);
        }
      }
    }
    for (const player of state.players) {
      collideCircles(player, ball, state.game === "haxball" ? 16 : 24, 11, state.game === "haxball" ? 3 : 6, 1, state.game === "haxball" ? 0.6 : 0.95, true);
      keepPlayerInBounds(player, state.game);
    }
    for (const segment of FIELD_WALLS[state.game]) collideCircleSegment(ball, 11, segment, state.game === "haxball" ? 0.72 : 0.92);
    keepBallInBounds(ball, state.game);
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    if (ballSpeed > max) { ball.vx *= max / ballSpeed; ball.vy *= max / ballSpeed; }
    if (ball.x < -HALF_WIDTH - 4 && Math.abs(ball.y) < goalHalf - 11) { scoreGoal(state, "orange"); break; }
    if (ball.x > HALF_WIDTH + 4 && Math.abs(ball.y) < goalHalf - 11) { scoreGoal(state, "blue"); break; }
  }
  state.revision += 1;
}

export function drawGame(ctx: CanvasRenderingContext2D, state: GameSnapshot, localPlayerId: string) {
  const { width, height } = ctx.canvas;
  const scale = Math.min(width / 1160, height / VIEW_HEIGHT);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090909";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);

  const field = ctx.createLinearGradient(-500, -280, 500, 280);
  field.addColorStop(0, "#11100f");
  field.addColorStop(0.5, "#1c1713");
  field.addColorStop(1, "#11100f");
  ctx.fillStyle = field;
  ctx.fillRect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);
  ctx.strokeStyle = "rgba(255,253,249,.6)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-HALF_WIDTH, -HALF_HEIGHT, FIELD_WIDTH, FIELD_HEIGHT);
  ctx.beginPath(); ctx.moveTo(0, -HALF_HEIGHT); ctx.lineTo(0, HALF_HEIGHT); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, state.game === "haxball" ? 75 : 65, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#ff8d4f";
  ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();

  const goalHalf = state.game === "haxball" ? 85 : 62;
  ctx.fillStyle = "rgba(255,253,249,.12)";
  ctx.fillRect(-HALF_WIDTH - 42, -goalHalf, 42, goalHalf * 2);
  ctx.fillStyle = "rgba(255,141,79,.16)";
  ctx.fillRect(HALF_WIDTH, -goalHalf, 42, goalHalf * 2);
  ctx.strokeStyle = "#fffdf9"; ctx.strokeRect(-HALF_WIDTH - 42, -goalHalf, 42, goalHalf * 2);
  ctx.strokeStyle = "#ff8d4f"; ctx.strokeRect(HALF_WIDTH, -goalHalf, 42, goalHalf * 2);

  if (state.game === "haxball") {
    for (const player of state.players) {
      if (!player.bot && player.charge > 0) {
        const direction = Math.hypot(player.aimX - player.x, player.aimY - player.y) || 1;
        const ux = (player.aimX - player.x) / direction;
        const uy = (player.aimY - player.y) / direction;
        const sideX = -uy;
        const sideY = ux;
        const startX = player.x + ux * 28;
        const startY = player.y + uy * 28;
        const reach = 110 + player.charge * 105;
        const bend = player.curve ? 26 + player.charge * 34 : 0;
        const controlX = startX + ux * reach * 0.55 + sideX * bend * 0.12;
        const controlY = startY + uy * reach * 0.55 + sideY * bend * 0.12;
        const endX = startX + ux * reach + sideX * bend;
        const endY = startY + uy * reach + sideY * bend;
        const tangent = Math.atan2(endY - controlY, endX - controlX);
        ctx.save();
        ctx.strokeStyle = player.team === "blue" ? "#ff8d4f" : "#fffdf9";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.moveTo(startX, startY); ctx.quadraticCurveTo(controlX, controlY, endX, endY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - Math.cos(tangent - 0.5) * 12, endY - Math.sin(tangent - 0.5) * 12);
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - Math.cos(tangent + 0.5) * 12, endY - Math.sin(tangent + 0.5) * 12);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  for (const player of state.players) {
    const radius = state.game === "haxball" ? 16 : 24;
    ctx.beginPath(); ctx.arc(player.x + 4, player.y + 6, radius + 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fill();
    ctx.beginPath(); ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = player.team === "blue" ? "#fffdf9" : "#ff8d4f"; ctx.fill();
    ctx.lineWidth = player.id === localPlayerId ? 4 : 2;
    ctx.strokeStyle = player.id === localPlayerId ? "#ff8d4f" : "#050505"; ctx.stroke();
    ctx.fillStyle = player.team === "blue" ? "#050505" : "#120c08";
    ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(player.bot ? "B" : "P", player.x, player.y + 1);
    if (state.game === "haxball") {
      const barWidth = 42;
      ctx.fillStyle = "rgba(0,0,0,.8)";
      ctx.fillRect(player.x - barWidth / 2 - 2, player.y - radius - 31, barWidth + 4, 7);
      ctx.fillStyle = "#514038";
      ctx.fillRect(player.x - barWidth / 2, player.y - radius - 29, barWidth, 3);
      ctx.fillStyle = player.stamina < 25 ? "#fffdf9" : "#ff8d4f";
      ctx.fillRect(player.x - barWidth / 2, player.y - radius - 29, barWidth * clamp(player.stamina / 100, 0, 1), 3);
    }
    ctx.fillStyle = "#fffdf9"; ctx.font = "10px monospace";
    ctx.fillText(player.name.slice(0, 12), player.x, player.y - radius - (state.game === "haxball" ? 41 : 13));
  }

  ctx.beginPath(); ctx.arc(state.ball.x + 3, state.ball.y + 4, 12, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fill();
  ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, 11, 0, Math.PI * 2);
  ctx.fillStyle = state.game === "haxball" ? "#fffdf9" : "#ff8d4f"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#050505"; ctx.stroke();
  ctx.restore();
}

export function pointerToField(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(canvas.width / 1160, canvas.height / VIEW_HEIGHT);
  const x = (clientX - bounds.left) * (canvas.width / bounds.width);
  const y = (clientY - bounds.top) * (canvas.height / bounds.height);
  return { x: clamp((x - canvas.width / 2) / scale, -HALF_WIDTH, HALF_WIDTH), y: clamp((y - canvas.height / 2) / scale, -HALF_HEIGHT, HALF_HEIGHT) };
}
