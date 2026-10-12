"use client";

import { ArrowLeft, ArrowRight, Copy, Maximize2, Minimize2, Pause, Play, RefreshCcw, Users, Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyGoal, createBotGame, createOnlineGame, drawGame, goalMouth, pickTeamFlags, reconcileAuthoritativeState, stepGame, updateOnlineRoster, type BotCounts, type GameActor, type GameInput, type GameObject, type GameSnapshot } from "@/lib/game-engine";
import type { GameId, GameRoom, GameTeam } from "@/lib/games";
import { gameAudio } from "@/lib/game-audio";
import { usePhaserEngine } from "@/lib/game-server";
import { GeckosRoomTransport, LAN_URL_KEY } from "@/lib/geckos-room";
import { TouchControls, type TouchState } from "@/components/touch-controls";
import { CountdownOverlay, useCountdown } from "@/components/countdown-overlay";

const PhaserGame = dynamic(() => import("@/components/phaser-game").then((module) => module.PhaserGame), { ssr: false });

const labels = { haxball: "FutBR", hoquei: "Hóquei" };
const descriptions = {
  haxball: "O futebol brasileiro de arena: drible, chute no clique e até cinco por equipe.",
  hoquei: "Hóquei de mesa em uma partida rápida de sete gols. Um jogador por equipe.",
};

const transportText = (udp: boolean, lan: boolean) => (!udp ? "HTTP (sondagem)" : lan ? "LAN ativa" : "UDP ativo");

/** Nomes de exibição por jogo: azul contra vermelho no gelo. */
const teamName = (game: GameId, team: GameTeam) =>
  game === "hoquei" ? (team === "blue" ? "azul" : "vermelha") : (team === "blue" ? "branca" : "laranja");
const teamNameCap = (game: GameId, team: GameTeam) =>
  game === "hoquei" ? (team === "blue" ? "Azul" : "Vermelha") : (team === "blue" ? "Branca" : "Laranja");

type RoomResponse = { room: GameRoom; playerId?: string; ownerToken?: string; player?: { id: string; team: GameTeam } };

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a operação.");
  return result as T;
}

function GameCanvas({ game, mode, bots, room, playerId, ownerToken, quality, onRoomUpdate }: {
  game: GameId;
  mode: "bot" | "online";
  bots: BotCounts;
  room: GameRoom | null;
  playerId: string | null;
  ownerToken: string | null;
  quality: "auto" | "high" | "low";
  onRoomUpdate: (room: GameRoom | null) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameSnapshot>(createBotGame(game, bots));
  const roomRef = useRef(room);
  const inputRef = useRef<GameInput>({ x: 0, y: 0, sprint: false, kickSeq: 0, dashSeq: 0, aimX: 0, aimY: 0, power: 0, spin: false, kickSpin: false, charging: false });
  const remoteInputsRef = useRef<Record<string, GameInput>>({});
  const lastKicksRef = useRef<Record<string, number>>({});
  const targetRef = useRef<GameSnapshot | null>(null);
  const targetRevisionRef = useRef(-1);
  const hasAuthoritativeRef = useRef(false);
  const geckosRef = useRef<GeckosRoomTransport | null>(null);
  const udpSnapTickRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());
  const touchRef = useRef<TouchState>({ x: 0, y: 0, active: false });
  const lastGoalCountRef = useRef(0);
  const hudScoreRef = useRef({ blue: 0, orange: 0 });
  const goalUntilRef = useRef(0);
  // Replay do gol: play → board (placar 1,8s) → replay → play.
  const phaseRef = useRef<"play" | "board" | "replay">("play");
  const pendingGoalRef = useRef<{ team: GameTeam } | null>(null);
  const boardUntilRef = useRef(0);
  const bufferRef = useRef<Array<{ t: number; players: GameActor[]; ball: GameObject }>>([]);
  const replayRef = useRef<{ frames: Array<{ t: number; players: GameActor[]; ball: GameObject }>; startT: number; duration: number; index: number } | null>(null);
  const replayTRef = useRef(0);
  const prevBallRef = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const postSfxAtRef = useRef(0);
  const prevDashRef = useRef(false);
  const matchPointRef = useRef(false);
  const pausedRef = useRef(false);
  const droppedRef = useRef(0);
  // Degradação automática de qualidade quando o render não acompanha.
  const qualityRef = useRef({ scale: 1, slow: 0, fast: 0 });

  const [hud, setHud] = useState({ blue: 0, orange: 0, elapsed: 0, winner: null as GameTeam | null, flags: pickTeamFlags() });
  const [goalNotice, setGoalNotice] = useState<{ team: GameTeam; blue: number; orange: number; id: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [metrics, setMetrics] = useState({ ping: 0, fps: 60, sim: 60, draw: 0, simMs: 0 });
  const [udpLive, setUdpLive] = useState(false);
  const [replayBadge, setReplayBadge] = useState(false);
  const [muted, setMuted] = useState(() => gameAudio.isMuted());
  const [paused, setPaused] = useState(false);
  const pingRef = useRef(0);
  const fpsRef = useRef(60);
  const netStatsRef = useRef({ snapshots: 0, inputSends: 0, snapshotSends: 0, driftMs: 0, lastDiag: 0 });
  const lastInputPersistAtRef = useRef(0);
  const lastSnapshotPersistAtRef = useRef(0);
  const roomId = room?.id ?? null;
  const roomStatus = room?.status;
  const isHost = mode === "online" && room?.ownerId === playerId && !!ownerToken;
  const { count: countValue, start: startCountdown, cancel: cancelCountdown, frozenRef: countdownFrozen } = useCountdown();

  const prevWinnerRef = useRef<GameTeam | null>(null);
  useEffect(() => {
    // Dono iniciou: contagem para todo mundo que está no campo.
    if (mode === "online" && roomStatus === "playing" && room?.ownerId === playerId && !!ownerToken) {
      startCountdown();
    }
  }, [roomStatus, mode, room, playerId, ownerToken, startCountdown]);
  useEffect(() => {
    if (hud.winner && prevWinnerRef.current !== hud.winner) gameAudio.play("whistleEnd", 1);
    prevWinnerRef.current = hud.winner;
  }, [hud.winner]);

  useEffect(() => { roomRef.current = room; }, [room]);

  useEffect(() => {
    stateRef.current = mode === "online" && roomRef.current
      ? createOnlineGame(game, roomRef.current.players)
      : createBotGame(game, bots);
    lastKicksRef.current = {};
    remoteInputsRef.current = {};
    targetRef.current = null;
    targetRevisionRef.current = -1;
    hasAuthoritativeRef.current = false;
    lastGoalCountRef.current = 0;
    hudScoreRef.current = { blue: 0, orange: 0 };
    goalUntilRef.current = 0;
    phaseRef.current = "play";
    pendingGoalRef.current = null;
    bufferRef.current = [];
    replayRef.current = null;
    matchPointRef.current = false;
    gameAudio.stopStomps();
    if (mode === "bot") startCountdown();
  }, [game, mode, bots, roomId, roomStatus, startCountdown]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    // Tela cheia automática ao entrar na partida. Sem gesto recente o
    // navegador recusa em silêncio e o botão da HUD assume.
    const board = boardRef.current;
    if (!board || document.fullscreenElement) return;
    try {
      const request = board.requestFullscreen() as unknown as Promise<void> | undefined;
      request?.catch(() => undefined);
    } catch {
      // segue sem tela cheia
    }
    return () => {
      if (document.fullscreenElement === board) {
        try {
          const exit = document.exitFullscreen() as unknown as Promise<void> | undefined;
          exit?.catch(() => undefined);
        } catch {
          // já saiu
        }
      }
    };
  }, []);

  // Câmera dinâmica: segue o jogador com antecipação e zoom, sem mostrar o
  // vazio fora do campo.
  const camRef = useRef({ x: 0, y: 0 });

  // Encerra o replay e volta ao jogo com contagem (placar já aplicado).
  // Sem vencedor: 1, 2, 3 e JÁ antes de soltar a bola de novo.
  const finishReplay = useCallback(() => {
    if (phaseRef.current !== "replay") return;
    replayRef.current = null;
    pendingGoalRef.current = null;
    setReplayBadge(false);
    bufferRef.current = [];
    phaseRef.current = "play";
    if (!stateRef.current.winner) startCountdown();
  }, [startCountdown]);

  // Chute sem mira: encostou na bola (38px) + clique/Espaço = chute de
  // potência fixa na direção em que a bola está, com leve antecipação.
  const triggerKick = useCallback(() => {
    if (phaseRef.current === "replay") {
      finishReplay();
      return;
    }
    const snapshot = stateRef.current;
    if (snapshot.game !== "haxball" || snapshot.freeze > 0 || snapshot.winner || phaseRef.current !== "play") return;
    const meId = mode === "bot" ? "local" : playerId;
    const me = snapshot.players.find((actor) => actor.id === meId && !actor.bot);
    if (!me || me.cooldown > 0) return;
    const dx = snapshot.ball.x - me.x;
    const dy = snapshot.ball.y - me.y;
    if (dx * dx + dy * dy > 40 * 40) return;
    inputRef.current.aimX = snapshot.ball.x + snapshot.ball.vx * 0.1;
    inputRef.current.aimY = snapshot.ball.y + snapshot.ball.vy * 0.1;
    inputRef.current.power = 0.62;
    inputRef.current.kickSpin = false;
    inputRef.current.kickSeq += 1;
  }, [finishReplay, mode, playerId]);

  // Pausa só no modo bot (no online a simulação é compartilhada).
  const togglePause = useCallback(() => {
    if (mode !== "bot") return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (event: KeyboardEvent) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyF", "KeyQ", "KeyP", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) {
        gameAudio.ensure();
        if (document.activeElement === canvas) event.preventDefault();
        const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
        const onCanvas = document.activeElement === canvas;
        if (game === "haxball" && event.code === "KeyQ" && !event.repeat && !typing) inputRef.current.dashSeq += 1;
        if (game === "haxball" && event.code === "Space" && !typing && onCanvas) triggerKick();
        if (event.code === "KeyP" && !typing && onCanvas) togglePause();
        keysRef.current.add(event.code);
      }
    };
    const onUp = (event: KeyboardEvent) => { keysRef.current.delete(event.code); };
    const onBlur = () => { keysRef.current.clear(); inputRef.current.x = 0; inputRef.current.y = 0; };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [game, triggerKick, togglePause]);

  useEffect(() => {
    // Busca e decodifica os sons cedo (sem precisar de gesto); o contexto
    // abre no primeiro clique ou tecla. A partida assume a torcida e cala o
    // tema do menu.
    gameAudio.preload();
    gameAudio.startMatch();
    gameAudio.stopMenu();
    if (mode === "bot") startCountdown();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: false, desynchronized: true });
    if (!canvas || !ctx) return;
    let frame = 0;
    let lastTime = performance.now();
    let hudTime = lastTime;
    let fpsFrames = 0;
    let simSteps = 0;
    let simMsAcc = 0;
    let renderMsAcc = 0;
    let fpsWindowStart = lastTime;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const effective = quality === "high" ? 1 : quality === "low" ? 0.65 : qualityRef.current.scale;
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * effective;
      canvas.width = Math.max(1, Math.round(bounds.width * dpr));
      canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // Passo fixo de 60 Hz desacoplado do render: a SIM anda em cadência
    // constante (anti-espiral com teto de 4 passos) e o FPS mede só o desenho.
    const STEP = 1 / 60;
    let acc = 0;

    const run = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.25);
      lastTime = now;
      fpsFrames += 1;

      if (now - fpsWindowStart >= 500) {
        const window = Math.max(1, now - fpsWindowStart);
        const fps = Math.round((fpsFrames * 1000) / window);
        const sim = Math.round((simSteps * 1000) / window);
        const draw = Math.round((renderMsAcc / Math.max(1, fpsFrames)) * 10) / 10;
        const simMs = Math.round((simMsAcc / Math.max(1, simSteps)) * 100) / 100;
        fpsRef.current = fps;
        // Degradação automática (só no modo auto): 3 janelas lentas reduzem
        // o render para 65%; 6 janelas boas restauram 100%.
        const auto = qualityRef.current;
        if (quality === "auto") {
          if (fps < 40) {
            auto.slow += 1;
            auto.fast = 0;
          } else if (fps > 55) {
            auto.fast += 1;
            auto.slow = 0;
          } else {
            auto.slow = 0;
            auto.fast = 0;
          }
          if (auto.slow >= 3 && auto.scale > 0.65) {
            auto.scale = 0.65;
            auto.slow = 0;
            auto.fast = 0;
            resize();
            console.info("[Perf] FPS baixo: render em 65% até recuperar.");
          } else if (auto.fast >= 6 && auto.scale < 1) {
            auto.scale = 1;
            auto.slow = 0;
            auto.fast = 0;
            resize();
            console.info("[Perf] FPS recuperado: render em 100%.");
          }
        }
        // Flush único a cada 500ms: evita re-render por medição de rede.
        setMetrics({ ping: pingRef.current, fps, sim, draw, simMs });
        if (droppedRef.current > 0) {
          console.warn(`[Perf] SIM descartou backlog ${droppedRef.current}x: física acima do teto por fatia.`);
          droppedRef.current = 0;
        }
        fpsFrames = 0;
        simSteps = 0;
        simMsAcc = 0;
        renderMsAcc = 0;
        fpsWindowStart = now;
      }

      const keys = keysRef.current;
      const touch = touchRef.current;
      const keysX = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      const keysY = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp"));
      inputRef.current.x = touch.active ? touch.x : keysX;
      inputRef.current.y = touch.active ? touch.y : keysY;
      inputRef.current.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");

      const currentRoom = roomRef.current;
      const host = mode === "online" && currentRoom?.ownerId === playerId && !!ownerToken;
      const authoritative = mode === "bot" ? true : host;
      // Replay local só para quem simula com autoridade (bot + host); o
      // convidado assiste ao gol pelo snapshot e mantém o placar antigo.
      const canReplay = mode === "bot" || host;
      const deadBall = phaseRef.current === "board" || phaseRef.current === "replay";
      const fireGoal = (team: GameTeam) => {
        if (!canReplay || phaseRef.current !== "play") return;
        // Placar primeiro: aplica o gol na hora e mostra o GOOOL por 1,8s.
        // O replay vem depois, com o gelo estendido para o reset cair no fim.
        const st = stateRef.current;
        const goalAt = st.elapsed;
        applyGoal(st, team);
        const kept = bufferRef.current.filter((frame) => frame.t >= goalAt - 4);
        const usable = kept.length > 1 ? kept : bufferRef.current.slice(-30);
        const span = usable.length > 1 ? usable[usable.length - 1].t - usable[0].t : 1;
        const duration = Math.max(1, Math.min(5, span));
        st.freeze = Math.max(st.freeze, 1.9 + duration);
        pendingGoalRef.current = { team };
        replayRef.current = { frames: usable, startT: usable[0]?.t ?? goalAt, duration, index: 0 };
        replayTRef.current = 0;
        phaseRef.current = "board";
        boardUntilRef.current = now + 1800;
      };
      const stepOptions = {
        authoritative,
        deferGoal: canReplay,
        onGoal: fireGoal,
        onCross: () => {
          if (canReplay) gameAudio.play("net", 1, game);
        },
      };

      const localId = mode === "bot" ? "local" : (playerId ?? "");
      const hideNames = quality === "low" || qualityRef.current.scale < 1;

      // Câmera: enche a tela com o campo (mapa pequeno cresce) e segue o
      // jogador com antecipação, sem mostrar o vazio fora do campo.
      const st = stateRef.current;
      const fw = st.field.w;
      const fh = st.field.h;
      const fitZoom = Math.max(1, Math.min(1160 / fw, 760 / fh) * 0.85);
      const zoom = fitZoom * 1.35;
      const meCam = st.players.find((actor) => actor.id === localId) ?? null;
      const look = 1 - Math.exp(-dt * 4.5);
      camRef.current.x += ((meCam ? meCam.x + meCam.vx * 0.25 : 0) - camRef.current.x) * look;
      camRef.current.y += ((meCam ? meCam.y + meCam.vy * 0.25 : 0) - camRef.current.y) * look;
      const viewW = 1160 / zoom;
      const viewH = 760 / zoom;
      const margin = 60;
      const loX = -fw / 2 - margin + viewW / 2;
      const hiX = fw / 2 + margin - viewW / 2;
      const loY = -fh / 2 - margin + viewH / 2;
      const hiY = fh / 2 + margin - viewH / 2;
      const cam = {
        x: loX > hiX ? 0 : Math.max(loX, Math.min(hiX, camRef.current.x)),
        y: loY > hiY ? 0 : Math.max(loY, Math.min(hiY, camRef.current.y)),
        zoom,
      };

      // Pausado: congela tudo e só desenha o quadro parado.
      if (pausedRef.current) {
        drawGame(ctx, stateRef.current, localId, { hideNames, cam });
        frame = requestAnimationFrame(run);
        return;
      }

      acc = Math.min(acc + dt, 0.25);
      let steps = 0;
      const tSim0 = performance.now();
      if (!countdownFrozen.current) {
        while (acc >= STEP && steps < 4) {
        if (mode === "bot") {
          stepGame(stateRef.current, deadBall ? {} : { local: inputRef.current }, lastKicksRef.current, STEP, stepOptions);
        } else if (mode === "online" && playerId && currentRoom?.status === "playing") {
          if (host) updateOnlineRoster(stateRef.current, currentRoom.players);
          stepGame(stateRef.current, deadBall ? {} : { ...remoteInputsRef.current, [playerId]: inputRef.current }, lastKicksRef.current, STEP, stepOptions);
          if (!host) {
            reconcileAuthoritativeState(stateRef.current, targetRef.current, playerId, STEP);
            // Atraso efetivo da sincronização: quanto o relógio local está à
            // frente do último snapshot do host (≈ latência de publicação).
            if (targetRef.current) netStatsRef.current.driftMs = Math.round((stateRef.current.elapsed - targetRef.current.elapsed) * 1000);
          }
        } else {
          break;
        }
        acc -= STEP;
        steps += 1;
        }
        if (steps === 4) {
          acc = 0;
          droppedRef.current += 1;
        }
        simMsAcc += performance.now() - tSim0;
        simSteps += steps;
      } else {
        acc = 0;
      }

      const tRender0 = performance.now();

      // Anel do replay: guarda os últimos ~12s com carimbo de tempo da sim.
      // O carimbo garante 1x na reprodução em qualquer taxa de quadros.
      // Congelado na contagem: nada para gravar.
      if (phaseRef.current === "play" && !countdownFrozen.current) {
        const snapshot = stateRef.current;
        bufferRef.current.push({
          t: snapshot.elapsed,
          players: snapshot.players.map((actor) => ({ ...actor })),
          ball: { ...snapshot.ball },
        });
        while (bufferRef.current.length > 720
          || (bufferRef.current.length > 60 && bufferRef.current[0].t < snapshot.elapsed - 12)) {
          bufferRef.current.shift();
        }
      }

      // Placar por 1,8s, depois o replay em velocidade real, depois o jogo.
      if (phaseRef.current === "board" && now >= boardUntilRef.current && replayRef.current) {
        phaseRef.current = "replay";
        replayTRef.current = 0;
        setReplayBadge(true);
      }

      if (phaseRef.current === "replay" && replayRef.current) {
        const replay = replayRef.current;
        replayTRef.current += dt;
        const target = replay.startT + replayTRef.current;
        while (replay.index < replay.frames.length - 1 && replay.frames[replay.index + 1].t <= target) {
          replay.index += 1;
        }
        if (replayTRef.current >= replay.duration) {
          finishReplay();
          drawGame(ctx, stateRef.current, localId, { hideNames, cam });
        } else {
          const frame = replay.frames[replay.index];
          drawGame(ctx, { ...stateRef.current, players: frame.players, ball: frame.ball }, localId, { hideNames, cam });
        }
      } else {
        drawGame(ctx, stateRef.current, localId, { hideNames, cam });
      }

      // Áudio: chute e disco (salto de velocidade), parede e tabelas
      // (inversão com o timbre do material), trave e dash próprio.
      {
        const sim = stateRef.current;
        const ball = sim.ball;
        const prev = prevBallRef.current;
        const prevSpeed = Math.sqrt(prev.vx * prev.vx + prev.vy * prev.vy);
        const curSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (curSpeed - prevSpeed > 250) {
          gameAudio.play("kick", curSpeed / 700, sim.game);
        } else if (curSpeed > 120 && ((prev.vx > 0) !== (ball.vx > 0) || (prev.vy > 0) !== (ball.vy > 0))) {
          gameAudio.play("wall", curSpeed / 800, sim.game);
        }
        if (curSpeed > 180 && now - postSfxAtRef.current > 400) {
          const hw = sim.field.w / 2;
          const mouth = goalMouth(sim.game, hw);
          const postHalf = sim.game === "haxball" ? 85 : 62;
          for (const px of [-mouth, mouth]) {
            for (const py of [-postHalf, postHalf]) {
              const pdx = ball.x - px;
              const pdy = ball.y - py;
              if (pdx * pdx + pdy * pdy < 30 * 30) {
                postSfxAtRef.current = now;
                gameAudio.play("post", 1, sim.game);
              }
            }
          }
        }
        const meId = mode === "bot" ? "local" : playerId;
        const me = sim.players.find((actor) => actor.id === meId);
        const dashing = !!me && me.dashRemaining > 0;
        if (dashing && !prevDashRef.current) gameAudio.play("dash", 0.8, sim.game);
        prevDashRef.current = dashing;
        prevBallRef.current = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
      }
      renderMsAcc += performance.now() - tRender0;

      const scores = stateRef.current.score;
      const totalGoals = scores.blue + scores.orange;
      if (totalGoals < lastGoalCountRef.current) {
        lastGoalCountRef.current = totalGoals;
        goalUntilRef.current = 0;
        setGoalNotice(null);
        phaseRef.current = "play";
        pendingGoalRef.current = null;
        bufferRef.current = [];
        replayRef.current = null;
        setReplayBadge(false);
      } else if (totalGoals > lastGoalCountRef.current) {
        lastGoalCountRef.current = totalGoals;
        if (stateRef.current.freeze > 0) {
          const team = scores.blue > hudScoreRef.current.blue ? "blue" : "orange";
          goalUntilRef.current = now + 1600;
          setGoalNotice({ team, blue: scores.blue, orange: scores.orange, id: totalGoals });
          gameAudio.play("goal", 1);
        }
      }
      hudScoreRef.current = { blue: scores.blue, orange: scores.orange };

      if (goalUntilRef.current > 0 && now >= goalUntilRef.current) {
        goalUntilRef.current = 0;
        setGoalNotice(null);
      }

      if (now - hudTime > 180) {
        const state = stateRef.current;
        setHud({ blue: state.score.blue, orange: state.score.orange, elapsed: state.elapsed, winner: state.winner, flags: state.flags });
        // Match-point empatado: batidas em loop até sair o gol do título.
        const target = state.game === "haxball" ? 5 : 7;
        const matchPoint = !state.winner && state.score.blue === state.score.orange && state.score.blue === target - 1;
        if (matchPoint && !matchPointRef.current) {
          matchPointRef.current = true;
          gameAudio.startStomps();
        } else if (!matchPoint && matchPointRef.current) {
          matchPointRef.current = false;
          gameAudio.stopStomps();
        }
        hudTime = now;
      }

      frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); gameAudio.stopMatch(); gameAudio.stopStomps(); };
  }, [game, mode, playerId, ownerToken, quality, finishReplay, countdownFrozen, startCountdown]);

  const acceptTarget = useCallback((snapshot: GameSnapshot, hard = false) => {
    const current = targetRef.current;
    // Reiniciar a partida zera o relógio junto com a revisão: sem tratar isso,
    // snapshots com revisão menor seriam rejeitados para sempre.
    const restarted = !!current && snapshot.elapsed + 1 < current.elapsed;
    if (!hard && !restarted && snapshot.revision < targetRevisionRef.current) return;
    targetRevisionRef.current = snapshot.revision;
    targetRef.current = snapshot;

    // A adoção dura (substituir a simulação local inteira) fica restrita ao
    // primeiro snapshot, às reconexões e aos reinícios da partida. No fluxo
    // normal o snapshot é apenas o ALVO da correção suave aplicada a cada
    // frame: adotá-lo inteiro faria o convidado voltar no tempo a cada evento
    // publicado pelo host (lag sentido por quem não criou a sala).
    if (hard || restarted || !hasAuthoritativeRef.current) {
      const firstEver = !hasAuthoritativeRef.current;
      stateRef.current = {
        ...snapshot,
        players: snapshot.players.map((actor) => ({ ...actor })),
        ball: { ...snapshot.ball },
        score: { ...snapshot.score },
      };
      hasAuthoritativeRef.current = true;
      // Convidado junto do apito inicial conta junto; entrando no meio de
      // partida em andamento, cancela a contagem e segue o jogo.
      if (firstEver) {
        if (snapshot.elapsed > 5) cancelCountdown();
        else startCountdown();
      }
      console.info(`[Net] Estado autoritativo adotado (rev=${snapshot.revision}, relógio=${snapshot.elapsed.toFixed(2)}s${hard ? ", adoção dura" : ""}).`);
    }
  }, [cancelCountdown, startCountdown]);

  const resync = useCallback(async (hard = false): Promise<boolean> => {
    if (mode !== "online" || !roomId || !playerId) return false;

    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/games/rooms/${roomId}/state?game=${game}`, { cache: "no-store" });
      pingRef.current = Math.max(0, Math.round(performance.now() - startedAt));

      if (response.status === 404) {
        onRoomUpdate(null);
        return false;
      }

      const state = await readResponse<{ room: GameRoom; snapshot: GameSnapshot | null; inputs: Record<string, GameInput> }>(response);
      roomRef.current = state.room;
      onRoomUpdate(state.room);
      remoteInputsRef.current = state.inputs;

      const host = state.room.ownerId === playerId && !!ownerToken;
      if (!host && state.room.status === "playing" && state.snapshot) {
        // Reconexões (force) adotam o estado inteiro; o polling de fallback
        // usa apenas o alvo suave, para não puxar o jogo de volta a cada leitura.
        acceptTarget(state.snapshot, hard);
      }

      setNetworkError("");
      return true;
    } catch (error) {
      console.error(`[Network] Resync failed:`, error);
      setNetworkError(error instanceof Error ? error.message : "Conexão indisponível.");
      return false;
    }
  }, [game, mode, roomId, playerId, ownerToken, onRoomUpdate, acceptTarget]);

  // Sem canal push, a sala chega pelo UDP (jogo) e pela sondagem HTTP
  // (lobby e fallback): resync periódico + heartbeat cobrem elenco e status.

  // Via rápida UDP (geckos.io no Render ou na LAN) para inputs/snapshots. O
  // HTTP continua persistindo tudo no Redis. Sem servidor, segue só no HTTP.
  useEffect(() => {
    if (mode !== "online" || !roomId || !playerId || !GeckosRoomTransport.available()) return;
    const transport = new GeckosRoomTransport();
    geckosRef.current = transport;
    let disposed = false;
    const timer = setInterval(() => {
      if (!disposed) setUdpLive(transport.status === "connected");
    }, 1000);
    void transport.connect(roomId, playerId).then((channel) => {
      if (disposed || !channel) return;
      transport.onSnapshot((snapshot) => {
        const current = roomRef.current;
        const host = current?.ownerId === playerId;
        if (!host && current?.status === "playing") {
          netStatsRef.current.snapshots += 1;
          acceptTarget(snapshot);
        }
      });
      transport.onInput((id, remoteInput) => {
        remoteInputsRef.current[id] = remoteInput;
      });
      setUdpLive(true);
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      transport.close();
      if (geckosRef.current === transport) geckosRef.current = null;
    };
  }, [mode, roomId, playerId, game, acceptTarget]);

  useEffect(() => {
    if (mode !== "online" || !roomId || !playerId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let inputInFlight = 0;
    let snapshotInFlight = 0;
    let lastInputJson: string | null = null;
    // Cadência fixa de 50ms, independente da latência. Cada transmissão leva
    // o estado mais recente e a próxima sai 50ms depois, mesmo com a anterior
    // em voo. Antes, esperar a resposta limitava o fluxo a ~2 envios/s.
    const TICK_MS = 50;
    const MAX_IN_FLIGHT = 3;
    // Com UDP ativo, inputs e snapshots vão direto (sem POST no caminho
    // quente); o POST fica como persistência para o Redis, que alimenta o
    // resync de quem entra ou reconecta e a sondagem de quem está sem UDP.
    const PERSIST_INPUT_MS = 250;
    const PERSIST_SNAPSHOT_MS = 300;

    const post = (payload: unknown) => {
      const startedAt = performance.now();
      return fetch(`/api/games/rooms/${roomId}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      }).then((response) => {
        // Ping = RTT da escrita (servidor + Redis), suavizado para o HUD.
        const sample = Math.max(0, Math.round(performance.now() - startedAt));
        pingRef.current = Math.round(pingRef.current ? pingRef.current * 0.6 + sample * 0.4 : sample);
        if (response.status === 404) {
          active = false;
          onRoomUpdate(null);
          return;
        }
        if (!response.ok) throw new Error("Conexão com a partida interrompida.");
        if (active) setNetworkError("");
      }).catch((error: unknown) => {
        console.error(`[Network] Falha na escrita:`, error);
        if (active) setNetworkError(error instanceof Error ? error.message : "Conexão indisponível.");
      });
    };

    const tick = () => {
      if (!active) return;
      const now = performance.now();
      const currentRoom = roomRef.current;
      const host = currentRoom?.ownerId === playerId && !!ownerToken;
      const playing = currentRoom?.status === "playing";
      const udp = geckosRef.current;
      const udpConnected = !!udp && udp.status === "connected";
      const stats = netStatsRef.current;

      // Input: só sai quando muda de fato (virar, correr, carregar o chute),
      // o que elimina o tráfego de um jogador parado.
      const inputJson = JSON.stringify(inputRef.current);
      const inputChanged = inputJson !== lastInputJson;
      // Input: via rápida UDP ao mudar; HTTP como transporte (sondagem) e
      // persistência quando sem UDP.
      if (inputChanged) {
        lastInputJson = inputJson;
        stats.inputSends += 1;
        if (udpConnected) udp.sendInput(playerId, { ...inputRef.current });
        else if (inputInFlight < MAX_IN_FLIGHT) {
          inputInFlight += 1;
          void post({ game, playerId, action: "input", input: { ...inputRef.current } }).finally(() => { inputInFlight -= 1; });
        }
      }
      if (udpConnected && now - lastInputPersistAtRef.current >= PERSIST_INPUT_MS && inputInFlight < 1) {
        inputInFlight += 1;
        lastInputPersistAtRef.current = now;
        void post({ game, playerId, action: "input", input: { ...inputRef.current } }).finally(() => { inputInFlight -= 1; });
      }

      // Snapshot: o host publica o estado autoritativo no mesmo ritmo. Cópia
      // rasa por nível, pois a simulação muta `stateRef.current` a cada frame
      // e a codificação da mensagem pode ocorrer depois do envio.
      if (host && playing) {
        const snapshotCopy: GameSnapshot = {
          ...stateRef.current,
          players: stateRef.current.players.map((actor) => ({ ...actor })),
          ball: { ...stateRef.current.ball },
          score: { ...stateRef.current.score },
        };
        stats.snapshotSends += 1;
        if (udpConnected) {
          // Snapshot do host via UDP a ~10 Hz (tick de 50ms, um sim um não).
          udpSnapTickRef.current += 1;
          if (udpSnapTickRef.current % 2 === 0) udp.sendSnapshot(snapshotCopy);
        }
        if (udpConnected) {
          if (now - lastSnapshotPersistAtRef.current >= PERSIST_SNAPSHOT_MS && snapshotInFlight < 1) {
            snapshotInFlight += 1;
            lastSnapshotPersistAtRef.current = now;
            void post({ game, playerId, ownerToken, action: "snapshot", snapshot: stateRef.current }).finally(() => { snapshotInFlight -= 1; });
          }
        } else if (snapshotInFlight < MAX_IN_FLIGHT) {
          snapshotInFlight += 1;
          void post({ game, playerId, ownerToken, action: "snapshot", snapshot: stateRef.current }).finally(() => { snapshotInFlight -= 1; });
        }
      }

      // Resumo de rede a cada ~2s: escrita, taxas e atraso de sync.
      if (stats.lastDiag === 0) stats.lastDiag = now;
      const diagWindow = now - stats.lastDiag;
      if (diagWindow >= 2000) {
        const via = udpConnected ? (udp && udp.lan ? "lan" : "udp") : "http";
        console.info(`[Net] sala=${roomId} via=${via} post=${pingRef.current}ms fps=${Math.round(fpsRef.current)} inputs=${Math.round((stats.inputSends * 1000) / diagWindow)}/s publicados=${Math.round((stats.snapshotSends * 1000) / diagWindow)}/s recebidos=${Math.round((stats.snapshots * 1000) / diagWindow)}/s atraso=${stats.driftMs}ms host=${host ? "sim" : "não"}`);
        stats.inputSends = 0;
        stats.snapshotSends = 0;
        stats.snapshots = 0;
        stats.lastDiag = now;
      }

      timer = setTimeout(tick, TICK_MS);
    };

    tick();
    return () => { active = false; clearTimeout(timer); };
  }, [game, mode, roomId, playerId, ownerToken, onRoomUpdate]);

  // Sondagem de leitura: ativa somente sem UDP (fallback). Com UDP, o jogo
  // chega pelo transporte rápido e o resync cobre entradas e reconexões.
  useEffect(() => {
    if (mode !== "online" || !roomId || !playerId || udpLive) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const read = async () => {
      if (!active) return;
      const ok = await resync();
      if (active) timer = setTimeout(read, ok ? 200 : 1000);
    };

    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [game, mode, roomId, playerId, udpLive, resync]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    gameAudio.ensure();
    if (phaseRef.current === "replay") {
      finishReplay();
      return;
    }
    if (game !== "haxball" || event.button !== 0) return;
    triggerKick();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === boardRef.current) await document.exitFullscreen();
      else await boardRef.current?.requestFullscreen();
    } catch {
      setNetworkError("Tela cheia indisponível neste navegador.");
    }
  };

  const time = `${String(Math.floor(hud.elapsed / 60)).padStart(2, "0")}:${String(Math.floor(hud.elapsed % 60)).padStart(2, "0")}`;
  // Semáforo da conexão: verde estável, amarelo atento, vermelho ruim.
  const pingTone = metrics.ping < 80 ? "ok" : metrics.ping < 180 ? "mid" : "bad";
  const fpsTone = metrics.fps > 55 ? "ok" : metrics.fps > 35 ? "mid" : "bad";
  const simTone = metrics.sim >= 55 ? "ok" : "bad";
  const lan = GeckosRoomTransport.isLan();
  const homeDot = game === "hoquei" ? "blue" : "white";
  const awayDot = game === "hoquei" ? "red" : "orange";
  return (
    <div ref={boardRef} className="game-board-wrap">
      <div className="game-board-hud">
        <div><span className={`score-dot ${homeDot}`} /> {teamNameCap(game, "blue")} <strong>{hud.blue}</strong></div>
        <span className="game-timer">{time}</span>
        <div><strong>{hud.orange}</strong> {teamNameCap(game, "orange")} <span className={`score-dot ${awayDot}`} /></div>
        <button type="button" className="game-fullscreen-button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "Sair da tela cheia" : "Colocar jogo em tela cheia"} title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>{isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      </div>

      <div className="game-canvas-shell">
        <div className="game-net-hud" role="status" aria-label="Desempenho e conexão">
          {mode === "online" && <span className="game-net-hud-mode">{!roomId || !playerId ? "Preparando sala…" : transportText(udpLive, lan)}</span>}
          {mode === "online" && <span className={`game-net-hud-${pingTone}`}><i aria-hidden="true" />ping {metrics.ping}ms</span>}
          <span className={`game-net-hud-${simTone}`}><i aria-hidden="true" />sim {metrics.sim}</span>
          <span className={`game-net-hud-${fpsTone}`}><i aria-hidden="true" />fps {metrics.fps}</span>
          <span className="game-net-hud-mode"><i aria-hidden="true" />draw {metrics.draw}ms</span>
        </div>
        {replayBadge && <button type="button" className="game-replay-badge" onClick={() => finishReplay()}><strong>Replay</strong> · clique para pular</button>}
        <CountdownOverlay value={countValue} />
        {paused && <div className="game-waiting">Pausado. Aperte P para continuar.</div>}

        <canvas ref={canvasRef} tabIndex={0} className="game-canvas" aria-label={`${labels[game]}: use WASD para mover${game === "haxball" ? ", clique ou Espaço para chutar" : ""}`} onPointerDown={onPointerDown} onContextMenu={(event) => event.preventDefault()} />
        <TouchControls game={game} touchRef={touchRef} keysRef={keysRef} onKick={() => triggerKick()} onDash={() => { inputRef.current.dashSeq += 1; }} />
        {mode === "online" && room?.status === "waiting" && <div className="game-waiting">{isHost ? "Convide jogadores e clique em Iniciar partida." : "Aguardando o dono iniciar a partida."}</div>}
        {goalNotice && <div key={goalNotice.id} className="game-goal-overlay" role="status"><span>GOOOL</span><strong><Image src={`/games/flags/4x3/${hud.flags[goalNotice.team]}.svg`} alt="" width={28} height={21} className="goal-flag" /> {goalNotice.blue} <i>·</i> {goalNotice.orange}</strong><small>Equipe {teamName(game, goalNotice.team)}</small></div>}
        {hud.winner && !goalNotice && <div className="game-waiting">Equipe {teamName(game, hud.winner)} venceu.</div>}
      </div>

      <div className="game-board-footer">
        <span>WASD ou setas: mover {game === "haxball" ? " · Clique ou Espaço: chute · Shift: correr · Q: dash na direção do movimento" : " · Empurre o disco para marcar gols"}{mode === "bot" ? " · P: pausar" : ""}</span>
        <span className="game-board-footer-right">
          {mode === "bot" && <button type="button" onClick={togglePause} aria-label={paused ? "Continuar" : "Pausar"} title={paused ? "Continuar (P)" : "Pausar (P)"}>{paused ? <Play size={15} /> : <Pause size={15} />} {paused ? "Continuar" : "Pausar"}</button>}
          <button type="button" onClick={() => { const next = !muted; gameAudio.setMuted(next); setMuted(next); if (!next) gameAudio.ensure(); }} aria-label={muted ? "Ativar som" : "Silenciar"} title={muted ? "Ativar som" : "Silenciar"}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />} {muted ? "Mudo" : "Som"}</button>
        </span>
        {networkError && <p className="game-error" role="status">{networkError}</p>}
      </div>
    </div>
  );
}

export function GameExperience({ game }: { game: GameId }) {
  const [mode, setMode] = useState<"bot" | "online">("bot");
  const [bots, setBots] = useState<BotCounts>({ blue: 1, orange: 2 });
  const [name, setName] = useState(() => typeof window === "undefined" ? "" : (sessionStorage.getItem("pedro-games-name") ?? ""));
  const [team, setTeam] = useState<GameTeam>("orange");
  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const phaser = usePhaserEngine();
  const [lanUrl, setLanUrl] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(LAN_URL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [lanSaved, setLanSaved] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return (window.localStorage.getItem(LAN_URL_KEY) ?? "").length > 0;
    } catch {
      return false;
    }
  });
  // Fluxo FutBR com cara de jogo: menu, ajustes, pré-partida e partida.
  const isFutBR = game === "haxball";
  const [futScreen, setFutScreen] = useState<"menu" | "setup" | "match" | "settings">("menu");
  const [quality, setQuality] = useState<"auto" | "high" | "low">(() => {
    if (typeof window === "undefined") return "auto";
    try {
      const saved = window.localStorage.getItem("pedro-games-quality");
      return saved === "high" || saved === "low" ? saved : "auto";
    } catch {
      return "auto";
    }
  });
  const [volume, setVolume] = useState(() => gameAudio.getVolume());
  // O FutBR tem página própria; os links de sala acompanham a página atual.
  const gamePath = game === "haxball" ? "/futbr" : `/games/${game}`;

  // Tema do menu toca sozinho nas telas (o contexto libera no gesto).
  useEffect(() => {
    if (!isFutBR) return;
    if (room?.status === "playing") return;
    if (futScreen === "menu" || futScreen === "settings" || futScreen === "setup") {
      gameAudio.preload();
      gameAudio.playMenu();
    }
  }, [isFutBR, futScreen, room]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
    if (!/^[A-Z0-9]{8}$/.test(requested)) return;
    const timer = setTimeout(async () => {
      console.log(`[Game] Auto-joining room: ${requested}`);
      setMode("online");
      if (game === "haxball") setFutScreen("setup");
      setRoomCode(requested);
      const saved = sessionStorage.getItem(`pedro-games:${game}:${requested}`);
      if (!saved) return;
      try {
        const { playerId: savedId, ownerToken: savedToken } = JSON.parse(saved) as { playerId: string; ownerToken?: string };
        const response = await fetch(`/api/games/rooms/${requested}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId: savedId, action: "join" }) });
        const data = await readResponse<RoomResponse>(response);
        console.log(`[Game] Rejoined room, isHost=${!!(savedToken)}`);
        setPlayerId(savedId);
        setOwnerToken(savedToken ?? null);
        setRoom(data.room);
      } catch {
        sessionStorage.removeItem(`pedro-games:${game}:${requested}`);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [game]);

  const loadRooms = useCallback(async () => {
    try {
      const response = await fetch(`/api/games/rooms?game=${game}`, { cache: "no-store" });
      const data = await readResponse<{ rooms: GameRoom[] }>(response);
      setRooms(data.rooms);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Salas indisponíveis.");
    }
  }, [game]);

  useEffect(() => {
    if (mode !== "online" || room) return;
    const first = setTimeout(() => void loadRooms(), 0);
    const interval = setInterval(() => void loadRooms(), 5000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [mode, room, loadRooms]);

  const activeRoomId = room?.id;
  const waitingLobby = room?.status === "waiting";
  useEffect(() => {
    if (!activeRoomId || !playerId) return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/games/rooms/${activeRoomId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, action: "heartbeat" }) });
        const data = await readResponse<RoomResponse>(response);
        setRoom(data.room);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Sala desconectada.");
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [game, activeRoomId, playerId]);

  // Lobby rápido: sem canal push, o elenco e o início chegam por sondagem.
  useEffect(() => {
    if (!activeRoomId || !playerId || !waitingLobby) return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/games/rooms/${activeRoomId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, action: "heartbeat" }) });
        const data = await readResponse<RoomResponse>(response);
        setRoom(data.room);
      } catch {
        // o heartbeat principal trata a queda
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [game, activeRoomId, playerId, waitingLobby]);

  const createRoom = async () => {
    if (name.trim().length < 2) { setError("Informe um nome com pelo menos dois caracteres."); return; }
    setBusy(true); setError("");
    try {
      sessionStorage.setItem("pedro-games-name", name.trim());
      const response = await fetch("/api/games/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, name: name.trim() }) });
      const data = await readResponse<RoomResponse>(response);
      console.log(`[Game] Room created: ${data.room.id}, isHost=true`);
      setRoom(data.room); setPlayerId(data.playerId ?? null); setOwnerToken(data.ownerToken ?? null);
      if (data.playerId) sessionStorage.setItem(`pedro-games:${game}:${data.room.id}`, JSON.stringify({ playerId: data.playerId, ownerToken: data.ownerToken }));
      window.history.replaceState({}, "", `${gamePath}?room=${data.room.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a sala."); }
    finally { setBusy(false); }
  };

  const joinRoom = async (id: string) => {
    if (name.trim().length < 2) { setError("Informe um nome com pelo menos dois caracteres."); return; }
    setBusy(true); setError("");
    try {
      sessionStorage.setItem("pedro-games-name", name.trim());
      const freshId = crypto.randomUUID();
      const response = await fetch(`/api/games/rooms/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, name: name.trim(), playerId: freshId, action: "join", team }) });
      const data = await readResponse<RoomResponse>(response);
      console.log(`[Game] Joined room: ${id}, isHost=false`);
      setRoom(data.room); setPlayerId(data.player?.id ?? freshId); setOwnerToken(null);
      sessionStorage.setItem(`pedro-games:${game}:${data.room.id}`, JSON.stringify({ playerId: data.player?.id ?? freshId }));
      window.history.replaceState({}, "", `${gamePath}?room=${data.room.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar na sala."); }
    finally { setBusy(false); }
  };

  const leaveRoom = async () => {
    if (room && playerId) {
      await fetch(`/api/games/rooms/${room.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, ownerToken, action: "leave" }) }).catch(() => undefined);
      sessionStorage.removeItem(`pedro-games:${game}:${room.id}`);
    }
    window.history.replaceState({}, "", gamePath);
    setRoom(null); setPlayerId(null); setOwnerToken(null); void loadRooms();
    if (game === "haxball") setFutScreen("setup");
  };

  const startRoom = async () => {
    if (!room || !playerId || !ownerToken) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/games/rooms/${room.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, ownerToken, action: "start" }) });
      const data = await readResponse<RoomResponse>(response);
      console.log(`[Game] Room started, players=${data.room.players.length}`);
      setRoom(data.room);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a partida."); }
    finally { setBusy(false); }
  };

  const onRoomUpdate = useCallback((updated: GameRoom | null) => {
    setRoom(updated);
    if (!updated) {
      setPlayerId(null);
      setOwnerToken(null);
      setError("A sala expirou ou foi encerrada.");
      window.history.replaceState({}, "", gamePath);
    }
  }, [gamePath]);

  const max = game === "haxball" ? 5 : 1;
  const numero = game === "haxball" ? "01" : "02";
  // FutBR online: partida montada (dono iniciou ou convidado sincronizou)
  // leva do pré-jogo ao campo sem estado extra.
  const screen = isFutBR && futScreen === "setup" && mode === "online" && room?.status === "playing" ? "match" : futScreen;
  const showSetup = !isFutBR || screen === "setup";
  const showMatch = !isFutBR || screen === "match";
  const exitMatch = () => {
    gameAudio.play("ui");
    if (mode === "online" && room) void leaveRoom();
    else setFutScreen("setup");
  };
  return (
    <main className={isFutBR ? "game-experience game-futbr shell" : "game-experience shell"}>
      {!isFutBR && (
        <>
          <div className="game-crumb">
            <Link href="/games"><ArrowLeft size={15} /> Todos os jogos</Link>
            <span>/</span>
            <span>{labels[game]}</span>
          </div>

          <div className="game-page-heading">
            <div>
              <p className="eyebrow">Playground / {numero}</p>
              <h1>{labels[game]}<span>.</span>{isFutBR && <em className="futbr-flag" aria-label="Brasil">🇧🇷</em>}</h1>
              <p>{descriptions[game]}</p>
            </div>
          </div>
        </>
      )}

      {isFutBR && futScreen === "menu" && (
        <div className="futbr-menu">
          <span className="futbr-flag-lg" role="img" aria-label="Bandeira do Brasil">🇧🇷</span>
          <p className="eyebrow">O futebol brasileiro de arena</p>
          <h2 className="futbr-logo">FutBR<span>.</span></h2>
          <p>Drible, chute no clique e até cinco por equipe. Escolha como entrar em campo.</p>
          <label className="futbr-name-row">Seu nome
            <input value={name} maxLength={20} onChange={(event) => { setName(event.target.value); try { sessionStorage.setItem("pedro-games-name", event.target.value); } catch { /* sem storage */ } }} placeholder="Como quer ser chamado?" />
          </label>
          <div className="futbr-menu-buttons">
            <button type="button" className="futbr-menu-primary" onClick={() => { gameAudio.play("ui"); setMode("bot"); setError(""); setFutScreen("setup"); }}>Jogar contra bots <ArrowRight size={16} /></button>
            <button type="button" onClick={() => { gameAudio.play("ui"); setMode("online"); setError(""); setFutScreen("setup"); }}>Jogar online <ArrowRight size={16} /></button>
            <button type="button" onClick={() => { gameAudio.play("ui"); setFutScreen("settings"); }}>Configurações</button>
          </div>
        </div>
      )}

      {isFutBR && futScreen === "settings" && (
        <div className="futbr-menu">
          <p className="eyebrow">Ajustes</p>
          <h2 className="futbr-logo">Opções<span>.</span></h2>
          <div className="futbr-settings">
            <label>Volume do jogo
              <span className="futbr-range-row">
                <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(event) => { const next = Number(event.target.value) / 100; gameAudio.setVolume(next); setVolume(next); }} aria-label="Volume do jogo" />
                <strong>{Math.round(volume * 100)}%</strong>
              </span>
            </label>
            <label>Qualidade do render
              <select value={quality} onChange={(event) => { const next = event.target.value as "auto" | "high" | "low"; try { window.localStorage.setItem("pedro-games-quality", next); } catch { /* sem storage */ } setQuality(next); }}>
                <option value="auto">Automática</option>
                <option value="high">Alta</option>
                <option value="low">Leve</option>
              </select>
            </label>
            <label>Seu nome nas salas
              <input value={name} maxLength={20} onChange={(event) => { setName(event.target.value); try { sessionStorage.setItem("pedro-games-name", event.target.value); } catch { /* sem storage */ } }} placeholder="Seu nome" />
            </label>
            <button type="button" onClick={() => { gameAudio.play("ui"); gameAudio.testNarrations(); }}>Ouvir narrações (1 e 2)</button>
            <button type="button" onClick={() => { gameAudio.play("ui"); setFutScreen("menu"); }}><ArrowLeft size={15} /> Voltar ao menu</button>
          </div>
        </div>
      )}

      {showSetup && (
        <>
          <div className="game-mode-switch" role="tablist" aria-label="Modo de jogo">
            <button role="tab" aria-selected={mode === "bot"} className={mode === "bot" ? "active" : ""} onClick={() => { if (room) void leaveRoom(); setMode("bot"); setError(""); }}>Versus bot</button>
            <button role="tab" aria-selected={mode === "online"} className={mode === "online" ? "active" : ""} onClick={() => { setMode("online"); setError(""); }}>Salas online</button>
          </div>
          {isFutBR && <div className="futbr-back-row"><button type="button" onClick={() => { if (room) void leaveRoom(); setFutScreen("menu"); }}><ArrowLeft size={15} /> Menu</button></div>}

      {mode === "bot" ? (

        <div className="game-setup">
          <div>
            <span className="game-overline">Partida local</span>
            <h2>{game === "haxball" ? "Monte as equipes" : "Você contra um bot"}</h2>
            <p>{game === "haxball" ? "Escolha quantos bots entram em campo para simular um jogo completo." : "Teste o controle e a física numa partida rápida."}</p>
          </div>
          {game === "haxball" && (
            <div className="bot-counts">
              <label>Aliados (0 a 4)
                <select value={bots.blue} onChange={(event) => setBots((value) => ({ ...value, blue: Number(event.target.value) }))}>
                  {Array.from({ length: 5 }, (_, index) => <option key={index} value={index}>{index}</option>)}
                </select>
              </label>
              <label>Adversários (1 a 5)
                <select value={bots.orange} onChange={(event) => setBots((value) => ({ ...value, orange: Number(event.target.value) }))}>
                  {Array.from({ length: 5 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      ) : (
        <div className="game-online-panel">
          {!room ? (
            <>
              <div className="game-online-head">
                <div>
                  <span className="game-overline">Salas públicas</span>
                  <h2>Entre em campo.</h2>
                  <p>Sem conta. Escolha um nome, crie uma sala ou entre em uma partida em andamento.</p>
                </div>
                <div className="game-online-controls">
                  <label>Seu nome
                    <input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} placeholder="Nome" onKeyDown={(event) => { if (event.key === "Enter" && !busy && name.trim().length >= 2) void createRoom(); }} />
                  </label>
                  <label>Equipe ao entrar
                    <select value={team} onChange={(event) => setTeam(event.target.value as GameTeam)}>
                      <option value="blue">{teamNameCap(game, "blue")}</option>
                      <option value="orange">{teamNameCap(game, "orange")}</option>
                    </select>
                  </label>
                  <button type="button" className="game-primary-button" disabled={busy || name.trim().length < 2} onClick={() => void createRoom()}>Criar sala <ArrowRight size={15} /></button>
                </div>
              </div>

              <div className="game-room-code-entry">
                <label>Código da sala
                  <input value={roomCode} maxLength={8} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="XXXXXXXX" />
                </label>
                <button type="button" className="button" onClick={() => { if (roomCode) void joinRoom(roomCode); }}>Entrar</button>
              </div>

              <div className="game-room-lan">
                <div>
                  <span className="game-overline">Rede local (LAN)</span>
                  <p>Sem internet: rode o servidor na sua máquina (<code>cd game-server e npm run dev</code>) e informe o endereço aqui nos aparelhos da mesma rede.</p>
                </div>
                <label>Servidor LAN
                  <input value={lanUrl} onChange={(event) => setLanUrl(event.target.value)} placeholder="http://192.168.0.10:9208" inputMode="url" />
                </label>
                {lanSaved
                  ? <button type="button" onClick={() => { try { window.localStorage.removeItem(LAN_URL_KEY); } catch { /* sem storage */ } setLanUrl(""); setLanSaved(false); }}>Usar online</button>
                  : <button type="button" disabled={!/^https?:\/\/.+/.test(lanUrl.trim())} onClick={() => { try { window.localStorage.setItem(LAN_URL_KEY, lanUrl.trim().replace(/\/$/, "")); } catch { /* sem storage */ } setLanSaved(true); }}>Usar LAN</button>}
              </div>

              <div className="game-room-list-head">
                <strong>Salas abertas</strong>
                <button type="button" onClick={() => void loadRooms()}><RefreshCcw size={15} /> Atualizar</button>
              </div>

              <div className="game-room-list">
                {rooms.length ? rooms.map((entry) => (
                  <div className="game-room-card" key={entry.id}>
                    <div>
                      <span className="game-room-code">#{entry.id}</span>
                      <strong>{entry.players[0]?.name ?? "Sala"}</strong>
                      <small>{entry.players.length}/{max + max} jogadores</small>
                    </div>
                    <button type="button" onClick={() => void joinRoom(entry.id)}>Entrar</button>
                  </div>
                )) : <p className="game-empty-state">Nenhuma sala aberta no momento.</p>}
              </div>
            </>
          ) : (
            <div className="game-active-room">
              <div className="game-active-heading">
                <div>
                  <span className="game-overline">Sala pública</span>
                  <h2>#{room.id}</h2>
                  <p>{room.status === "waiting" ? "Aguardando o dono iniciar a partida." : "Partida em andamento."}</p>
                </div>
                <div className="game-room-actions">
                  <button type="button" onClick={() => navigator.clipboard.writeText(`${location.origin}${gamePath}?room=${room.id}`)}><Copy size={15} /> Copiar link</button>
                  <button type="button" onClick={() => void leaveRoom()} className="ghost">Sair</button>
                </div>
              </div>

              <div className="game-roster">
                <div>
                  <strong>Equipe {teamName(game, "blue")}</strong>
                  {room.players.filter((p) => p.team === "blue").map((p) => (
                    <span key={p.id}>{p.name}{p.id === playerId ? " (você)" : ""}</span>
                  ))}
                </div>
                <div>
                  <strong>Equipe {teamName(game, "orange")}</strong>
                  {room.players.filter((p) => p.team === "orange").map((p) => (
                    <span key={p.id}>{p.name}{p.id === playerId ? " (você)" : ""}</span>
                  ))}
                </div>
              </div>

              {room.status === "waiting" && room.ownerId === playerId && ownerToken && (
                <div className="game-start-row">
                  <span>{room.players.some((p) => p.team === "blue") && room.players.some((p) => p.team === "orange") ? "Tudo pronto para iniciar." : "Precisa de um jogador em cada lado."}</span>
                  <button type="button" onClick={() => void startRoom()} className="button">Iniciar partida</button>
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="game-error">{error}</p>}
        </div>
      )}
      {isFutBR && mode === "bot" && (
        <div className="futbr-start-row"><button type="button" className="game-primary-button" onClick={() => { gameAudio.play("ui"); setFutScreen("match"); }}>Entrar em campo <ArrowRight size={16} /></button></div>
      )}
        </>
      )}

      {showMatch && (mode === "bot" || room) && (
        <>
          {isFutBR && <div className="futbr-back-row"><button type="button" onClick={exitMatch}><ArrowLeft size={15} /> Sair da partida</button></div>}
          {mode === "bot" && phaser
        ? <PhaserGame key={`phaser-${game}-${bots.blue}-${bots.orange}`} game={game} bots={bots} />
        : <GameCanvas
          key={`${game}-${mode}-${bots.blue}-${bots.orange}-${room?.id ?? "local"}`}
          game={game}
          mode={mode}
          bots={bots}
          room={room}
          playerId={playerId}
          ownerToken={ownerToken}
          quality={quality}
          onRoomUpdate={onRoomUpdate}
        />
          }
        </>
      )}

      <div className="game-notes">
        <div><Users size={19} /><span>{game === "haxball" ? "Até cinco por equipe nas salas online" : "Um jogador por equipe nas salas online"}</span></div>
        <p>Todos preveem a partida a 60 fps e convergem pelo estado autoritativo do criador da sala, via UDP, LAN ou HTTP. O indicador mostra ping, SIM (física) e FPS (render): verde estável, amarelo atento, vermelho instável.</p>
      </div>
    </main>
  );
}
