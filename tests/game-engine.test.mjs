import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/game-engine.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createOnlineGame, createBotGame, resolveKickDirection, stepGame } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const roster = [
  { id: "white", name: "Branco", team: "blue", joinedAt: 0, lastSeen: 0 },
  { id: "orange", name: "Laranja", team: "orange", joinedAt: 0, lastSeen: 0 },
];

const input = (extra = {}) => ({
  x: 0, y: 0, sprint: false, kickSeq: 0, aimX: 0, aimY: 0,
  power: 0, spin: false, kickSpin: false, charging: false, ...extra,
});

test("a estamina limita o sprint e regenera ao descansar", () => {
  const state = createOnlineGame("haxball", roster);
  const kicks = {};
  for (let frame = 0; frame < 240; frame++) stepGame(state, { white: input({ x: 1, sprint: true }) }, kicks, 1 / 60);
  assert.ok(state.players[0].stamina < 10);
  assert.ok(state.players[0].sprintLock);
  for (let frame = 0; frame < 180; frame++) stepGame(state, { white: input() }, kicks, 1 / 60);
  assert.ok(state.players[0].stamina >= 25);
  assert.equal(state.players[0].sprintLock, false);
});

test("jogadores saem um pouco do campo, mas colidem entre si", () => {
  const state = createOnlineGame("haxball", roster);
  state.ball.x = 300;
  state.ball.y = 180;
  state.players[0].x = -530;
  stepGame(state, {}, {}, 1 / 60);
  assert.equal(state.players[0].x, -530);
  state.players[0].x = 0;
  state.players[0].y = 0;
  state.players[1].x = 12;
  state.players[1].y = 0;
  stepGame(state, {}, {}, 1 / 60);
  assert.ok(Math.hypot(state.players[1].x - state.players[0].x, state.players[1].y - state.players[0].y) >= 31.9);
});

test("a bola rebate na parede e não deixa o campo pela lateral", () => {
  const state = createOnlineGame("haxball", roster);
  state.ball.x = 0;
  state.ball.y = -265;
  state.ball.vy = -400;
  stepGame(state, {}, {}, 1 / 60);
  assert.ok(state.ball.y >= -269);
  assert.ok(state.ball.vy > 0);
  state.ball.x = 486;
  state.ball.y = 180;
  state.ball.vx = 500;
  state.ball.vy = 0;
  stepGame(state, {}, {}, 1 / 60);
  assert.ok(state.ball.x <= 489);
  state.ball.x = 496;
  state.ball.y = 180;
  state.ball.vx = 1000;
  stepGame(state, {}, {}, 1 / 60);
  assert.ok(state.ball.x <= 489);
});

test("não chuta de costas; com F, o chute faz curva na direção da mira", () => {
  const state = createOnlineGame("haxball", roster);
  const player = state.players[0];
  state.ball.x = player.x - 35;
  state.ball.y = player.y;
  const kicks = {};
  stepGame(state, { white: input({ kickSeq: 1, aimX: player.x + 200, aimY: player.y, power: 1 }) }, kicks, 1 / 60);
  assert.equal(state.ball.spin ?? 0, 0);
  assert.ok(Math.abs(state.ball.vx) < 1);

  state.ball.x = player.x + 35;
  state.ball.y = player.y;
  state.ball.vx = 0;
  state.ball.vy = 0;
  stepGame(state, { white: input({ kickSeq: 2, aimX: player.x + 200, aimY: player.y, power: 1, kickSpin: true }) }, kicks, 1 / 60);
  assert.ok((state.ball.spin ?? 0) > 0);
  assert.ok(state.ball.vx > 0);
  assert.ok(state.ball.vy > 0);
});

test("o chute respeita o cone de 45 graus em todas as orientações", () => {
  const player = { x: 0, y: 0 };
  for (const angle of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
    const ball = { x: Math.cos(angle) * 35, y: Math.sin(angle) * 35 };
    const aim = angle + Math.PI * 0.4;
    const direction = resolveKickDirection(player, ball, Math.cos(aim) * 200, Math.sin(aim) * 200);
    assert.ok(direction);
    const dot = (direction.x * ball.x + direction.y * ball.y) / 35;
    assert.ok(dot >= Math.cos(Math.PI / 4) - 0.0001);
    assert.equal(resolveKickDirection(player, ball, -ball.x, -ball.y), null);
  }
});

test("o bot do hóquei recua para defender a trajetória do disco", () => {
  const state = createBotGame("hoquei", { blue: 0, orange: 1 });
  const bot = state.players.find((player) => player.bot);
  state.ball.x = -60;
  state.ball.y = 125;
  state.ball.vx = 500;
  state.ball.vy = 0;
  const beforeX = bot.x;
  const beforeY = bot.y;
  stepGame(state, {}, {}, 1 / 60);
  assert.ok(bot.x > beforeX);
  assert.ok(bot.y > beforeY);
  assert.ok(bot.x <= 476);
});

test("o disco do hóquei tem limite de velocidade reduzido", () => {
  const state = createOnlineGame("hoquei", roster);
  state.ball.x = 0;
  state.ball.y = 120;
  state.ball.vx = 2000;
  stepGame(state, {}, {}, 1 / 60);
  assert.ok(Math.hypot(state.ball.vx, state.ball.vy) <= 1050.01);
});

test("um gol atualiza o placar e pausa a partida", () => {
  const state = createOnlineGame("hoquei", roster);
  state.ball.x = 500;
  state.ball.y = 0;
  state.ball.vx = 700;
  stepGame(state, {}, {}, 1 / 60);
  assert.equal(state.score.blue, 1);
  assert.ok(state.freeze > 0);
});
