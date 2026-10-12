"use client";

import { useEffect, useRef } from "react";
import { gameAudio } from "@/lib/game-audio";
import {
  createBotGame,
  FULL_FIELD,
  stepGame,
  type BotCounts,
  type GameInput,
  type GameSnapshot,
} from "@/lib/game-engine";
import type { GameId } from "@/lib/games";

/**
 * Motor Phaser dos jogos (bot mode).
 *
 * Arquitetura: o Phaser é dono do loop, da escala, do input (teclado + mouse)
 * e da renderização; a simulação determinística continua no módulo
 * `lib/game-engine` (a mesma usada pelo Canvas, pelo servidor UDP e pelos
 * testes), então bots, física da rede e reconciliação online valem para os
 * dois renderizadores. As cenas abaixo espelham a paleta do `drawGame`:
 * gramado verde listrado com marcações brancas no haxball e gelo fosco com
 * linhas azul/vermelho/preto no hóquei.
 */

const WORLD_W = 1160;
const WORLD_H = 760;
const FIELD_W = 1000;
const FIELD_H = 560;

function stripeColor(i: number): number {
  return i % 2 === 0 ? 0x2f9e44 : 0x2a9140;
}

export function PhaserGame({ game, bots }: { game: GameId; bots: BotCounts }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const blueCount = bots.blue;
  const orangeCount = bots.orange;

  useEffect(() => {
    gameAudio.preload();
    let destroyed = false;
    let phaserGame: { destroy: (removeCanvas: boolean) => void } | null = null;

    void (async () => {
      const Phaser = (await import("phaser")).default;
      if (destroyed || !hostRef.current) return;

      const isHaxball = game === "haxball";
      // Tamanho cheio fixo nesta cena; o mapa dinâmico por times vale no Canvas.
      const state: GameSnapshot = createBotGame(game, { blue: blueCount, orange: orangeCount }, FULL_FIELD);
      const lastKicks: Record<string, number> = {};
      const input: GameInput = {
        x: 0, y: 0, sprint: false, kickSeq: 0, dashSeq: 0,
        aimX: 0, aimY: 0, power: 0, spin: false, kickSpin: false, charging: false,
      };
      // Chute sem mira: encostou + clicou/Espaço = chute de potência fixa.
      const triggerKick = () => {
        if (!isHaxball || state.freeze > 0 || state.winner) return;
        const me = state.players.find((p) => p.id === "local" && !p.bot);
        if (!me || me.cooldown > 0) return;
        const dx = state.ball.x - me.x;
        const dy = state.ball.y - me.y;
        if (dx * dx + dy * dy > 40 * 40) return;
        input.aimX = state.ball.x + state.ball.vx * 0.1;
        input.aimY = state.ball.y + state.ball.vy * 0.1;
        input.power = 0.62;
        input.kickSpin = false;
        input.kickSeq += 1;
        gameAudio.play("kick", 0.7, game);
      };
      let prevDash = false;

      class ArenaScene extends Phaser.Scene {
        private gfx!: Phaser.GameObjects.Graphics;
        private keys!: Record<string, Phaser.Input.Keyboard.Key>;
        private flagTexts: Phaser.GameObjects.Text[] = [];

        create() {
          this.gfx = this.add.graphics();
          const flagSize = isHaxball ? "15px" : "21px";
          for (const p of state.players) {
            const text = this.add.text(0, 0, state.flags[p.team] ?? "", {
              fontSize: flagSize,
              fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",monospace',
            }).setOrigin(0.5);
            this.flagTexts.push(text);
          }
          const kb = this.input.keyboard;
          if (kb) {
            this.keys = kb.addKeys(
              "W,A,S,D,F,Q,SHIFT,UP,DOWN,LEFT,RIGHT",
            ) as Record<string, Phaser.Input.Keyboard.Key>;
          }
          this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            input.aimX = this.fieldX(p.worldX);
            input.aimY = this.fieldY(p.worldY);
          });
          this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
            if (!isHaxball || !p.leftButtonDown()) return;
            gameAudio.ensure();
            triggerKick();
          });
          kb?.on("keydown-Q", () => {
            input.dashSeq += 1;
          });
          kb?.on("keydown-SPACE", () => {
            gameAudio.ensure();
            triggerKick();
          });
        }

        private fieldX(worldX: number): number {          return Phaser.Math.Clamp(worldX - WORLD_W / 2, -1000, 1000);
        }

        private fieldY(worldY: number): number {
          return Phaser.Math.Clamp(worldY - WORLD_H / 2, -1000, 1000);
        }

        override update(_time: number, deltaMs: number) {
          const dt = Math.min(deltaMs / 1000, 0.05);
          const k = this.keys;
          if (k) {
            input.x = Number(k.D.isDown || k.RIGHT.isDown) - Number(k.A.isDown || k.LEFT.isDown);
            input.y = Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown);
            input.sprint = !!k.SHIFT?.isDown;
          }
          stepGame(state, { local: input }, lastKicks, dt);
          const me = state.players.find((p) => p.id === "local");
          const dashing = isHaxball && !!me && me.dashRemaining > 0;
          if (dashing && !prevDash) gameAudio.play("dash", 0.8, game);
          prevDash = dashing;
          this.draw(state);
        }

        private draw(s: GameSnapshot) {
          const g = this.gfx;
          g.clear();
          const ox = WORLD_W / 2 - FIELD_W / 2;
          const oy = WORLD_H / 2 - FIELD_H / 2;
          if (s.game === "haxball") this.drawPitch(g, ox, oy, s);
          else this.drawRink(g, ox, oy);
          // Jogadores sem borda preta; só o anel de destaque de quem joga.
          // Azul contra vermelho no gelo, bandeira do time no peito.
          for (let i = 0; i < s.players.length; i++) {
            const p = s.players[i];
            const r = s.game === "haxball" ? 16 : 24;
            const px = p.x + WORLD_W / 2;
            const py = p.y + WORLD_H / 2;
            const fill = p.team === "blue" ? (isHaxball ? 0xfffdf9 : 0x2456e6) : (isHaxball ? 0xff8d4f : 0xd7263d);
            g.fillStyle(fill, 1);
            g.fillCircle(px, py, r);
            if (p.flash > 0) {
              g.fillStyle(0xffffff, Math.min(0.65, (p.flash / 0.18) * 0.65));
              g.fillCircle(px, py, r);
            }
            if (p.id === "local") {
              g.lineStyle(3, s.game === "haxball" ? 0xffd166 : 0xffffff, 1);
              g.strokeCircle(px, py, r + 4);
            }
            this.flagTexts[i]?.setPosition(px, py + 1);
          }
          // Bola / disco sem contorno.
          const bx = s.ball.x + WORLD_W / 2;
          const by = s.ball.y + WORLD_H / 2;
          if (s.game === "haxball") {
            g.fillStyle(0xfffdf9, 1);
            g.fillCircle(bx, by, 8);
          } else {
            g.fillStyle(0x141414, 1);
            g.fillCircle(bx, by, 8);
          }
          const ballFlash = s.ball.flash ?? 0;
          if (ballFlash > 0) {
            g.fillStyle(0xffffff, Math.min(0.6, (ballFlash / 0.18) * 0.6));
            g.fillCircle(bx, by, 8);
          }
        }

        private drawPitch(g: Phaser.GameObjects.Graphics, ox: number, oy: number, s: GameSnapshot) {
          g.fillStyle(0x0d1a0f, 1);
          g.fillRect(0, 0, WORLD_W, WORLD_H);
          const stripes = 10;
          const sw = FIELD_W / stripes;
          for (let i = 0; i < stripes; i++) {
            g.fillStyle(stripeColor(i), 1);
            g.fillRect(ox + i * sw, oy, sw + 1, FIELD_H);
          }
          g.lineStyle(4, 0xffffff, 0.95);
          g.strokeRect(ox, oy, FIELD_W, FIELD_H);
          g.lineBetween(ox + FIELD_W / 2, oy, ox + FIELD_W / 2, oy + FIELD_H);
          g.strokeCircle(ox + FIELD_W / 2, oy + FIELD_H / 2, 75);
          g.fillStyle(0xffffff, 0.95);
          g.fillCircle(ox + FIELD_W / 2, oy + FIELD_H / 2, 5);
          for (const side of [-1, 1]) {
            const gx = side < 0 ? ox : ox + FIELD_W - 140;
            const sx = side < 0 ? ox : ox + FIELD_W - 55;
            g.lineStyle(3, 0xffffff, 0.95);
            g.strokeRect(gx, oy + FIELD_H / 2 - 160, 140, 320);
            g.strokeRect(sx, oy + FIELD_H / 2 - 95, 55, 190);
            g.fillStyle(0xffffff, 0.95);
            g.fillCircle(ox + FIELD_W / 2 + side * (FIELD_W / 2 - 105), oy + FIELD_H / 2, 4.5);
          }
          // Redes com malha + barriga conforme a bola afunda no pano.
          const goalHalf = 85;
          const depth = 70;
          for (const side of [-1, 1] as const) {
            const inNet = Math.sign(s.ball.x) === side && Math.abs(s.ball.x) > FIELD_W / 2;
            const bulge = inNet ? Math.min(1, (Math.abs(s.ball.x) - FIELD_W / 2) / depth) * 14 : 0;
            const nx = side < 0 ? ox - depth - bulge : ox + FIELD_W;
            const ny = oy + FIELD_H / 2 - goalHalf;
            g.fillStyle(0xffffff, 0.1);
            g.fillRect(nx, ny, depth + bulge, goalHalf * 2);
            g.lineStyle(1, 0xffffff, 0.38);
            for (let gx = 0; gx <= depth + bulge; gx += 9) g.lineBetween(nx + gx, ny, nx + gx, ny + goalHalf * 2);
            for (let gy = 0; gy <= goalHalf * 2; gy += 9) g.lineBetween(nx, ny + gy, nx + depth + bulge, ny + gy);
            g.lineStyle(3, 0xffffff, 1);
            g.strokeRect(nx, ny, depth + bulge, goalHalf * 2);
          }
        }

        private drawRink(g: Phaser.GameObjects.Graphics, ox: number, oy: number) {
          g.fillStyle(0x101418, 1);
          g.fillRect(0, 0, WORLD_W, WORLD_H);
          g.fillStyle(0xedf0f2, 1);
          g.fillRect(ox, oy, FIELD_W, FIELD_H);
          g.lineStyle(10, 0x111111, 1);
          g.strokeRect(ox, oy, FIELD_W, FIELD_H);
          g.lineStyle(5, 0xe8b921, 1);
          g.strokeRect(ox + 8, oy + 8, FIELD_W - 16, FIELD_H - 16);
          g.fillStyle(0xc8102e, 1);
          g.fillRect(ox + FIELD_W / 2 - 6, oy, 12, FIELD_H);
          g.lineStyle(5, 0x0b3d91, 1);
          g.strokeCircle(ox + FIELD_W / 2, oy + FIELD_H / 2, 70);
          g.fillStyle(0x0b3d91, 1);
          g.fillCircle(ox + FIELD_W / 2, oy + FIELD_H / 2, 7);
          g.fillStyle(0x0b3d91, 1);
          for (const dx of [-160, 160]) g.fillRect(ox + FIELD_W / 2 + dx - 8, oy, 16, FIELD_H);
          g.fillStyle(0xc8102e, 1);
          for (const dx of [-445, 445]) g.fillRect(ox + FIELD_W / 2 + dx - 2, oy, 4, FIELD_H);
          for (const [fx, fy] of [[-300, -160], [-300, 160], [300, -160], [300, 160]]) {
            const cx = ox + FIELD_W / 2 + fx;
            const cy = oy + FIELD_H / 2 + fy;
            g.lineStyle(4, 0xc8102e, 1);
            g.strokeCircle(cx, cy, 56);
            g.fillStyle(0xc8102e, 1);
            g.fillCircle(cx, cy, 6);
          }
          // Redes dentro do rinque, sobre a linha do gol.
          const goalHalf = 62;
          const depth = 42;
          const cx = ox + FIELD_W / 2;
          for (const side of [-1, 1] as const) {
            const nx = side < 0 ? cx - 445 - depth : cx + 445;
            const ny = oy + FIELD_H / 2 - goalHalf;
            g.fillStyle(0xffffff, 0.75);
            g.fillRect(nx, ny, depth, goalHalf * 2);
            g.lineStyle(1, 0x78828c, 0.5);
            for (let gx = 0; gx <= depth; gx += 8) g.lineBetween(nx + gx, ny, nx + gx, ny + goalHalf * 2);
            for (let gy = 0; gy <= goalHalf * 2; gy += 8) g.lineBetween(nx, ny + gy, nx + depth, ny + gy);
            g.lineStyle(4, 0xc8102e, 1);
            g.strokeRect(nx, ny, depth, goalHalf * 2);
          }
        }
      }

      phaserGame = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: WORLD_W,
        height: WORLD_H,
        backgroundColor: "#0d1a0f",
        physics: {
          default: "arcade",
          arcade: { gravity: { x: 0, y: 0 }, debug: false },
        },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [ArenaScene],
        fps: { target: 60 },
      });
    })();

    return () => {
      destroyed = true;
      phaserGame?.destroy(true);
      phaserGame = null;
    };
  }, [game, blueCount, orangeCount]);

  return <div ref={hostRef} className="phaser-shell" aria-label={`Campo ${game} no motor Phaser`} />;
}
