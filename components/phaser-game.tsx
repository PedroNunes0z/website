"use client";

import { useEffect, useRef } from "react";
import { gameAudio } from "@/lib/game-audio";
import { CountdownOverlay, useCountdown } from "@/components/countdown-overlay";
import {
  applyGoal,
  createBotGame,
  FULL_FIELD,
  stepGame,
  type BotCounts,
  type GameInput,
  type GameSnapshot,
} from "@/lib/game-engine";
import type { GameId, GameTeam } from "@/lib/games";

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

function stripeColor(i: number): number {
  return i % 2 === 0 ? 0x2f9e44 : 0x2a9140;
}

export function PhaserGame({ game, bots }: { game: GameId; bots: BotCounts }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const blueCount = bots.blue;
  const orangeCount = bots.orange;
  const { count: countValue, start: startCountdown, frozenRef: countdownFrozen } = useCountdown();

  useEffect(() => {
    // Tela cheia automática ao entrar na partida (sem gesto, recusa quieta).
    const host = hostRef.current;
    if (host && !document.fullscreenElement) {
      try {
        const request = host.requestFullscreen() as unknown as Promise<void> | undefined;
        request?.catch(() => undefined);
      } catch {
        // segue sem tela cheia
      }
    }
    gameAudio.preload();
    gameAudio.startMatch();
    gameAudio.stopMenu();
    startCountdown(600);
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
        if (!me) return;
        // Feedback imediato no aperto, acertando a bola ou não.
        me.flash = 0.18;
        if (me.cooldown > 0) return;
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
      let pausedGame = false;
      let prevWinner: GameTeam | null = null;

      class ArenaScene extends Phaser.Scene {
        private gfx!: Phaser.GameObjects.Graphics;
        private keys!: Record<string, Phaser.Input.Keyboard.Key>;
        private flagImgs = new Map<string, Phaser.GameObjects.Image>();

        create() {
          this.gfx = this.add.graphics();
          const flagUrl = (team: string) => `/games/flags/4x3/${state.flags[team as "blue" | "orange"]}.svg`;
          this.load.image("flag-blue", flagUrl("blue"));
          this.load.image("flag-orange", flagUrl("orange"));
          this.load.once(Phaser.Loader.Events.COMPLETE, () => {
            for (const p of state.players) {
              const img = this.add.image(0, 0, p.team === "blue" ? "flag-blue" : "flag-orange");
              const r = state.game === "haxball" ? 16 : 24;
              img.setDisplaySize(r * 1.25, r * 1.25 * 0.75);
              this.flagImgs.set(p.id, img);
            }
          });
          this.load.start();
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
          const pauseText = this.add.text(WORLD_W / 2, 90, "PAUSADO (P)", {
            fontSize: "22px",
            fontFamily: "monospace",
            color: "#ffffff",
            backgroundColor: "rgba(0,0,0,0.65)",
            padding: { x: 12, y: 8 },
          }).setOrigin(0.5).setVisible(false);
          kb?.on("keydown-P", () => {
            pausedGame = !pausedGame;
            pauseText.setVisible(pausedGame);
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
          if (!countdownFrozen.current && !pausedGame) {
            stepGame(state, { local: input }, lastKicks, dt, {
              deferGoal: true,
              onGoal: (team) => {
                applyGoal(state, team);
                if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                  this.cameras.main.shake(350, 0.012);
                }
              },
            });
            const me = state.players.find((p) => p.id === "local");
            const dashing = isHaxball && !!me && me.dashRemaining > 0;
            if (dashing && !prevDash) gameAudio.play("dash", 0.8, game);
            prevDash = dashing;
            if (state.winner && state.winner !== prevWinner) {
              prevWinner = state.winner;
              gameAudio.play("whistleEnd", 1);
            }
          }
          // Câmera fixa no centro do campo: sempre alinhada e enquadrada.
          const fw = state.field.w;
          const fh = state.field.h;
          const zoom = Math.max(1, Math.min(1160 / fw, 760 / fh) * 0.85);
          const cam = this.cameras.main;
          cam.setZoom(zoom);
          cam.centerOn(WORLD_W / 2, WORLD_H / 2);
          this.draw(state);
        }

        private draw(s: GameSnapshot) {
          const g = this.gfx;
          g.clear();
          // Campo dinâmico por roster: centralizado no mundo, como na física.
          const fw = s.field.w;
          const fh = s.field.h;
          const ox = WORLD_W / 2 - fw / 2;
          const oy = WORLD_H / 2 - fh / 2;
          if (s.game === "haxball") this.drawPitch(g, ox, oy, s);
          else this.drawRink(g, ox, oy, s);
          // Jogadores sem borda: círculo do time e estrela, sem anel.
          // Azul contra vermelho no gelo, bandeira do time no peito.
          for (let i = 0; i < s.players.length; i++) {
            const p = s.players[i];
            const r = s.game === "haxball" ? 16 : 24;
            const px = p.x + WORLD_W / 2;
            const py = p.y + WORLD_H / 2;
            const fill = p.team === "blue" ? (isHaxball ? 0x009c3b : 0x2456e6) : (isHaxball ? 0xffd400 : 0xd7263d);
            g.fillStyle(fill, 1);
            g.fillCircle(px, py, r);
            if (p.flash > 0) {
              g.fillStyle(0xffffff, Math.min(0.65, (p.flash / 0.18) * 0.65));
              g.fillCircle(px, py, r);
            }
            this.flagImgs.get(p.id)?.setPosition(px, py + 1);
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
          const fw = s.field.w;
          const fh = s.field.h;
          g.fillStyle(0x0d1a0f, 1);
          g.fillRect(0, 0, WORLD_W, WORLD_H);
          const stripes = 10;
          const sw = fw / stripes;
          for (let i = 0; i < stripes; i++) {
            g.fillStyle(stripeColor(i), 1);
            g.fillRect(ox + i * sw, oy, sw + 1, fh);
          }
          g.lineStyle(4, 0xffffff, 0.95);
          g.strokeRect(ox, oy, fw, fh);
          g.lineBetween(ox + fw / 2, oy, ox + fw / 2, oy + fh);
          g.strokeCircle(ox + fw / 2, oy + fh / 2, 75);
          g.fillStyle(0xffffff, 0.95);
          g.fillCircle(ox + fw / 2, oy + fh / 2, 5);
          for (const side of [-1, 1]) {
            const gx = side < 0 ? ox : ox + fw - 140;
            const sx = side < 0 ? ox : ox + fw - 55;
            g.lineStyle(3, 0xffffff, 0.95);
            g.strokeRect(gx, oy + fh / 2 - 160, 140, 320);
            g.strokeRect(sx, oy + fh / 2 - 95, 55, 190);
            g.fillStyle(0xffffff, 0.95);
            g.fillCircle(ox + fw / 2 + side * (fw / 2 - 105), oy + fh / 2, 4.5);
          }
          // Redes com malha + barriga conforme a bola afunda no pano.
          const goalHalf = 85;
          const depth = 70;
          for (const side of [-1, 1] as const) {
            const inNet = Math.sign(s.ball.x) === side && Math.abs(s.ball.x) > fw / 2;
            const bulge = inNet ? Math.min(1, (Math.abs(s.ball.x) - fw / 2) / depth) * 14 : 0;
            const nx = side < 0 ? ox - depth - bulge : ox + fw;
            const ny = oy + fh / 2 - goalHalf;
            g.fillStyle(0xffffff, 0.1);
            g.fillRect(nx, ny, depth + bulge, goalHalf * 2);
            g.lineStyle(1, 0xffffff, 0.38);
            for (let gx = 0; gx <= depth + bulge; gx += 9) g.lineBetween(nx + gx, ny, nx + gx, ny + goalHalf * 2);
            for (let gy = 0; gy <= goalHalf * 2; gy += 9) g.lineBetween(nx, ny + gy, nx + depth + bulge, ny + gy);
            g.lineStyle(3, 0xffffff, 1);
            g.strokeRect(nx, ny, depth + bulge, goalHalf * 2);
          }
        }

        private drawRink(g: Phaser.GameObjects.Graphics, ox: number, oy: number, s: GameSnapshot) {
          const fw = s.field.w;
          const fh = s.field.h;
          g.fillStyle(0x101418, 1);
          g.fillRect(0, 0, WORLD_W, WORLD_H);
          g.fillStyle(0xedf0f2, 1);
          g.fillRect(ox, oy, fw, fh);
          g.lineStyle(10, 0x111111, 1);
          g.strokeRect(ox, oy, fw, fh);
          g.lineStyle(5, 0xe8b921, 1);
          g.strokeRect(ox + 8, oy + 8, fw - 16, fh - 16);
          g.fillStyle(0xc8102e, 1);
          g.fillRect(ox + fw / 2 - 6, oy, 12, fh);
          g.lineStyle(5, 0x0b3d91, 1);
          g.strokeCircle(ox + fw / 2, oy + fh / 2, 70);
          g.fillStyle(0x0b3d91, 1);
          g.fillCircle(ox + fw / 2, oy + fh / 2, 7);
          g.fillStyle(0x0b3d91, 1);
          for (const dx of [-160, 160]) g.fillRect(ox + fw / 2 + dx - 8, oy, 16, fh);
          g.fillStyle(0xc8102e, 1);
          for (const dx of [-445, 445]) g.fillRect(ox + fw / 2 + dx - 2, oy, 4, fh);
          for (const [fx, fy] of [[-300, -160], [-300, 160], [300, -160], [300, 160]]) {
            const cx = ox + fw / 2 + fx;
            const cy = oy + fh / 2 + fy;
            g.lineStyle(4, 0xc8102e, 1);
            g.strokeCircle(cx, cy, 56);
            g.fillStyle(0xc8102e, 1);
            g.fillCircle(cx, cy, 6);
          }
          // Redes dentro do rinque, sobre a linha do gol.
          const goalHalf = 62;
          const depth = 42;
          const cx = ox + fw / 2;
          for (const side of [-1, 1] as const) {
            const nx = side < 0 ? cx - 445 - depth : cx + 445;
            const ny = oy + fh / 2 - goalHalf;
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
      gameAudio.stopMatch();
      if (host && document.fullscreenElement === host) {
        try {
          const exit = document.exitFullscreen() as unknown as Promise<void> | undefined;
          exit?.catch(() => undefined);
        } catch {
          // já saiu
        }
      }
      phaserGame?.destroy(true);
      phaserGame = null;
    };
  }, [game, blueCount, orangeCount, startCountdown, countdownFrozen]);

  return <div ref={hostRef} className="phaser-shell" aria-label={`Campo ${game} no motor Phaser`}><CountdownOverlay value={countValue} /></div>;
}
