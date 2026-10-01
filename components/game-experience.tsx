"use client";

import { ArrowLeft, ArrowRight, Copy, Maximize2, Minimize2, RefreshCcw, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBotGame, createOnlineGame, drawGame, pointerToField, reconcileAuthoritativeState, stepGame, updateOnlineRoster, type BotCounts, type GameInput, type GameSnapshot } from "@/lib/game-engine";
import type { GameId, GameRoom, GameTeam } from "@/lib/games";
import { isVersionedEvent, type RealtimeClientEvent } from "@/lib/realtime";
import { useAblyRoom, type RealtimeStatus } from "@/lib/use-ably-room";

const labels = { haxball: "Haxball", hoquei: "Hóquei" };
const descriptions = {
  haxball: "Futebol de arena com chute carregado, movimentação e até cinco jogadores por equipe.",
  hoquei: "Hóquei de mesa em uma partida rápida de sete gols. Um jogador por equipe.",
};

const connLabels: Record<Exclude<RealtimeStatus, "idle">, string> = {
  connecting: "Conectando ao tempo real…",
  connected: "Tempo real ativo",
  disconnected: "Reconectando à sala…",
  suspended: "Conexão instável — tentando de novo…",
  failed: "Tempo real indisponível — modo compatibilidade (HTTP)",
  fallback: "Modo compatibilidade (HTTP)",
};

type RoomResponse = { room: GameRoom; playerId?: string; ownerToken?: string; player?: { id: string; team: GameTeam } };

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a operação.");
  return result as T;
}

function GameCanvas({ game, mode, bots, room, playerId, ownerToken, onRoomUpdate }: {
  game: GameId;
  mode: "bot" | "online";
  bots: BotCounts;
  room: GameRoom | null;
  playerId: string | null;
  ownerToken: string | null;
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
  const keysRef = useRef<Set<string>>(new Set());
  const pointerDownAt = useRef(0);
  const lastGoalCountRef = useRef(0);
  const hudScoreRef = useRef({ blue: 0, orange: 0 });
  const goalUntilRef = useRef(0);
  
  const [hud, setHud] = useState({ blue: 0, orange: 0, elapsed: 0, winner: null as GameTeam | null });
  const [goalNotice, setGoalNotice] = useState<{ team: GameTeam; blue: number; orange: number; id: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [metrics, setMetrics] = useState({ ping: 0, fps: 60, lastSnapshotTime: 0, snapshotCount: 0 });
  
  const roomId = room?.id ?? null;
  const roomStatus = room?.status;
  const isHost = mode === "online" && room?.ownerId === playerId && !!ownerToken;

  const pingColor = metrics.ping < 80 ? "#4ade80" : metrics.ping < 180 ? "#facc15" : "#f87171";
  const fpsColor = metrics.fps > 55 ? "#4ade80" : metrics.fps > 35 ? "#facc15" : "#f87171";

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
  }, [game, mode, bots, roomId, roomStatus]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (event: KeyboardEvent) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyF", "KeyQ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) {
        if (document.activeElement === canvas) event.preventDefault();
        const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
        if (game === "haxball" && event.code === "KeyQ" && !event.repeat && !typing) inputRef.current.dashSeq += 1;
        keysRef.current.add(event.code);
      }
    };
    const onUp = (event: KeyboardEvent) => { keysRef.current.delete(event.code); };
    const onBlur = () => { keysRef.current.clear(); inputRef.current.x = 0; inputRef.current.y = 0; inputRef.current.charging = false; };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [game]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    let lastTime = performance.now();
    let hudTime = lastTime;
    let fpsFrames = 0;
    let fpsWindowStart = lastTime;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * dpr));
      canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const run = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      fpsFrames += 1;

      if (now - fpsWindowStart >= 500) {
        const fps = (fpsFrames * 1000) / (now - fpsWindowStart);
        setMetrics((prev) => ({ ...prev, fps: Math.round(fps) }));
        fpsFrames = 0;
        fpsWindowStart = now;
      }

      const keys = keysRef.current;
      inputRef.current.x = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      inputRef.current.y = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp"));
      inputRef.current.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
      inputRef.current.spin = keys.has("KeyF");
      if (inputRef.current.charging) inputRef.current.power = Math.min(1, (now - pointerDownAt.current) / 900);

      const currentRoom = roomRef.current;
      const host = mode === "online" && currentRoom?.ownerId === playerId && !!ownerToken;

      if (mode === "bot") {
        stepGame(stateRef.current, { local: inputRef.current }, lastKicksRef.current, dt);
      } else if (mode === "online" && playerId && currentRoom?.status === "playing") {
        if (host) updateOnlineRoster(stateRef.current, currentRoom.players);
        stepGame(stateRef.current, { ...remoteInputsRef.current, [playerId]: inputRef.current }, lastKicksRef.current, dt, { authoritative: host });
        if (!host) {
          if (targetRef.current) {
            console.debug(`[Game] Guest reconcile: local_elapsed=${stateRef.current.elapsed.toFixed(2)}, target_elapsed=${targetRef.current.elapsed.toFixed(2)}, diff=${(stateRef.current.elapsed - targetRef.current.elapsed).toFixed(2)}`);
            reconcileAuthoritativeState(stateRef.current, targetRef.current, playerId, dt);
          }
        }
      }

      if (game === "haxball" && mode === "online" && !host && playerId) {
        const localActor = stateRef.current.players.find((actor) => actor.id === playerId);
        if (localActor) {
          localActor.charge = inputRef.current.charging ? inputRef.current.power : 0;
          localActor.curve = inputRef.current.spin;
          localActor.aimX = inputRef.current.aimX;
          localActor.aimY = inputRef.current.aimY;
        }
      }

      drawGame(ctx, stateRef.current, mode === "bot" ? "local" : (playerId ?? ""));

      const scores = stateRef.current.score;
      const totalGoals = scores.blue + scores.orange;
      if (totalGoals < lastGoalCountRef.current) {
        lastGoalCountRef.current = totalGoals;
        goalUntilRef.current = 0;
        setGoalNotice(null);
      } else if (totalGoals > lastGoalCountRef.current) {
        lastGoalCountRef.current = totalGoals;
        if (stateRef.current.freeze > 0) {
          const team = scores.blue > hudScoreRef.current.blue ? "blue" : "orange";
          goalUntilRef.current = now + 1600;
          setGoalNotice({ team, blue: scores.blue, orange: scores.orange, id: totalGoals });
        }
      }
      hudScoreRef.current = { blue: scores.blue, orange: scores.orange };

      if (goalUntilRef.current > 0 && now >= goalUntilRef.current) {
        goalUntilRef.current = 0;
        setGoalNotice(null);
      }

      if (now - hudTime > 180) {
        const state = stateRef.current;
        setHud({ blue: state.score.blue, orange: state.score.orange, elapsed: state.elapsed, winner: state.winner });
        hudTime = now;
      }

      frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [game, mode, playerId, ownerToken]);

  const lastResyncRef = useRef(0);

  const acceptTarget = useCallback((snapshot: GameSnapshot, hard = false) => {
    const current = targetRef.current;
    const restarted = !current || snapshot.elapsed + 1 < current.elapsed;
    const newer = !current || snapshot.revision > current.revision || snapshot.elapsed > current.elapsed + 0.08;

    if (!hard && !restarted && !newer && snapshot.revision < targetRevisionRef.current) {
      console.debug(`[Sync] Ignoring outdated snapshot: rev=${snapshot.revision}, targetRev=${targetRevisionRef.current}`);
      return;
    }

    console.debug(`[Sync] Accepting snapshot: hard=${hard}, rev=${snapshot.revision}, elapsed=${snapshot.elapsed.toFixed(2)}`);
    targetRevisionRef.current = snapshot.revision;
    targetRef.current = snapshot;

    if (hard || !hasAuthoritativeRef.current || newer) {
      stateRef.current = {
        ...snapshot,
        players: snapshot.players.map((actor) => ({ ...actor })),
        ball: { ...snapshot.ball },
        score: { ...snapshot.score },
      };
      hasAuthoritativeRef.current = true;
    }
  }, []);

  const resync = useCallback(async (hard = false): Promise<boolean> => {
    if (mode !== "online" || !roomId || !playerId) return false;

    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/games/rooms/${roomId}/state?game=${game}`, { cache: "no-store" });
      const ping = Math.max(0, Math.round(performance.now() - startedAt));
      setMetrics((prev) => ({ ...prev, ping }));
      console.log(`[Network] Resync ping: ${ping}ms`);

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
        console.log(`[Sync] Received snapshot from host: rev=${state.snapshot.revision}, elapsed=${state.snapshot.elapsed.toFixed(2)}`);
        acceptTarget(state.snapshot, hard || true);
      }

      setNetworkError("");
      return true;
    } catch (error) {
      console.error(`[Network] Resync failed:`, error);
      setNetworkError(error instanceof Error ? error.message : "Conexão indisponível.");
      return false;
    }
  }, [game, mode, roomId, playerId, ownerToken, onRoomUpdate, acceptTarget]);

  const requestResync = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastResyncRef.current < 1500) return;
    lastResyncRef.current = now;
    console.log(`[Sync] Requesting resync (force=${force})`);
    void resync(force);
  }, [resync]);

  const handleRealtimeEvent = useCallback((event: RealtimeClientEvent) => {
    console.log(`[Realtime] Event received:`, event.type, event.name);

    if (event.type === "resync") {
      console.log(`[Realtime] Resync triggered:`, event.reason);
      requestResync(true);
      return;
    }

    const data = event.data;
    if (!isVersionedEvent(data)) {
      console.warn(`[Realtime] Unknown event version, requesting resync`);
      requestResync();
      return;
    }

    const currentRoom = roomRef.current;
    const host = currentRoom?.ownerId === playerId && !!ownerToken;

    switch (event.name) {
      case "game-snapshot-updated":
        if (!host && data.playerId !== playerId && currentRoom?.status === "playing" && data.snapshot) {
          console.log(`[Realtime] Snapshot from ${data.playerId}: rev=${data.snapshot.revision}, elapsed=${data.snapshot.elapsed.toFixed(2)}`);
          setMetrics((prev) => ({ ...prev, lastSnapshotTime: Date.now(), snapshotCount: prev.snapshotCount + 1 }));
          acceptTarget(data.snapshot, true);
        }
        break;
      case "game-input-updated":
        if (data.playerId && data.input) {
          console.debug(`[Input] From ${data.playerId}: x=${data.input.x}, y=${data.input.y}`);
          remoteInputsRef.current[data.playerId] = data.input;
        }
        break;
      case "game-state-updated":
      case "player-joined":
      case "player-left":
        if (data.room) {
          console.log(`[Room] Event: ${event.name}, players=${data.room.players.length}`);
          roomRef.current = data.room;
          onRoomUpdate(data.room);
        } else {
          requestResync();
        }
        break;
      case "game-ended":
        console.log(`[Room] Game ended`);
        onRoomUpdate(null);
        break;
    }
  }, [playerId, ownerToken, onRoomUpdate, requestResync, acceptTarget]);

  const realtimeStatus = useAblyRoom({
    roomId: mode === "online" ? roomId : null,
    game,
    playerId: mode === "online" ? playerId : null,
    onEvent: handleRealtimeEvent,
  });
  const realtimeLive = realtimeStatus === "connected";

  useEffect(() => {
    if (mode !== "online" || !roomId || !playerId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const write = async () => {
      let nextDelay = 50;
      const startedAt = performance.now();

      try {
        const base = `/api/games/rooms/${roomId}/state`;
        const currentRoom = roomRef.current;
        const host = currentRoom?.ownerId === playerId && !!ownerToken;

        const requests: Promise<Response>[] = [
          fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ game, playerId, action: "input", input: inputRef.current }),
            cache: "no-store",
          }),
        ];

        if (host && currentRoom?.status === "playing") {
          console.debug(`[Host] Publishing snapshot: rev=${stateRef.current.revision}, elapsed=${stateRef.current.elapsed.toFixed(2)}`);
          requests.push(fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ game, playerId, ownerToken, action: "snapshot", snapshot: stateRef.current }),
            cache: "no-store",
          }));
        }

        const responses = await Promise.all(requests);
        const ping = Math.max(0, Math.round(performance.now() - startedAt));
        setMetrics((prev) => ({ ...prev, ping }));

        if (!active) return;

        for (const response of responses) {
          if (response.status === 404) {
            console.error(`[Network] Room not found`);
            active = false;
            onRoomUpdate(null);
            return;
          }
          if (!response.ok) throw new Error("Conexão com a partida interrompida.");
        }

        setNetworkError("");
      } catch (error) {
        nextDelay = 500;
        console.error(`[Network] Write failed:`, error);
        if (active) setNetworkError(error instanceof Error ? error.message : "Conexão indisponível.");
      } finally {
        if (active) timer = setTimeout(write, nextDelay);
      }
    };

    void write();
    return () => { active = false; clearTimeout(timer); };
  }, [game, mode, roomId, playerId, ownerToken, onRoomUpdate]);

  useEffect(() => {
    if (mode !== "online" || !roomId || !playerId || realtimeLive) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const read = async () => {
      if (!active) return;
      console.debug(`[Sync] Polling (fallback)`);
      const ok = await resync();
      if (active) timer = setTimeout(read, ok ? 200 : 1000);
    };

    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [game, mode, roomId, playerId, realtimeLive, resync]);

  const updateAim = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || game !== "haxball") return;
    const aim = pointerToField(canvas, event.clientX, event.clientY);
    inputRef.current.aimX = aim.x;
    inputRef.current.aimY = aim.y;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    if (game !== "haxball" || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDownAt.current = performance.now();
    inputRef.current.charging = true;
    inputRef.current.power = 0;
    updateAim(event);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (game !== "haxball" || !inputRef.current.charging) return;
    updateAim(event);
    inputRef.current.power = Math.min(1, (performance.now() - pointerDownAt.current) / 900);
    inputRef.current.kickSpin = keysRef.current.has("KeyF");
    inputRef.current.charging = false;
    inputRef.current.kickSeq += 1;
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === boardRef.current) await document.exitFullscreen();
      else await boardRef.current?.requestFullscreen();
    } catch {
      setNetworkError("Tela cheia indisponível neste navegador.");
    }
  };

  const reset = () => {
    if (mode === "bot") stateRef.current = createBotGame(game, bots);
    else if (isHost && roomRef.current) stateRef.current = createOnlineGame(game, roomRef.current.players);
    lastKicksRef.current = {};
    setGoalNotice(null);
  };

  const time = `${String(Math.floor(hud.elapsed / 60)).padStart(2, "0")}:${String(Math.floor(hud.elapsed % 60)).padStart(2, "0")}`;
  
  return (
    <div ref={boardRef} className="game-board-wrap">
      <div className="game-board-hud">
        <div><span className="score-dot white" /> Branco <strong>{hud.blue}</strong></div>
        <span className="game-timer">{time}</span>
        <div><strong>{hud.orange}</strong> Laranja <span className="score-dot orange" /></div>
        <button type="button" className="game-fullscreen-button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "Sair da tela cheia" : "Colocar jogo em tela cheia"} title={isFullscreen ? "Sair da tela cheia" : "Colocar jogo em tela cheia"}>{isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      </div>

      <div className="game-canvas-shell">
        {mode === "online" && (
          <div style={{
            position: "absolute",
            top: 12,
            right: 12,
            display: "flex",
            gap: 10,
            zIndex: 999,
            padding: "8px 12px",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            fontFamily: "monospace",
            fontSize: 11,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.9)",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ color: pingColor, display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: pingColor, boxShadow: `0 0 8px ${pingColor}` }} />
                PING {metrics.ping}ms
              </span>
              <span style={{ color: fpsColor, display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: fpsColor, boxShadow: `0 0 8px ${fpsColor}` }} />
                FPS {metrics.fps}
              </span>
            </div>
            {mode === "online" && !isHost && (
              <div style={{ borderLeft: "1px solid rgba(255,255,255,0.2)", paddingLeft: 10, display: "flex", flexDirection: "column", gap: 3, fontSize: 10 }}>
                <span>Snapshots: {metrics.snapshotCount}</span>
                <span>Last: {metrics.lastSnapshotTime > 0 ? `${Date.now() - metrics.lastSnapshotTime}ms` : "—"}</span>
              </div>
            )}
          </div>
        )}

        <canvas ref={canvasRef} tabIndex={0} className="game-canvas" aria-label={`${labels[game]}: use WASD para mover${game === "haxball" ? " e o mouse para chutar" : ""}`} onPointerDown={onPointerDown} onPointerMove={updateAim} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
        {mode === "online" && room?.status === "waiting" && <div className="game-waiting">{isHost ? "Convide jogadores e clique em Iniciar partida." : "Aguardando o dono iniciar a partida."}</div>}
        {goalNotice && <div key={goalNotice.id} className="game-goal-overlay" role="status"><span>GOOOL</span><strong>{goalNotice.blue} <i>—</i> {goalNotice.orange}</strong><small>Equipe {goalNotice.team === "blue" ? "branca" : "laranja"}</small></div>}
        {hud.winner && !goalNotice && <div className="game-waiting">Equipe {hud.winner === "blue" ? "branca" : "laranja"} venceu.</div>}
      </div>

      <div className="game-board-footer">
        <span>WASD ou setas: mover {game === "haxball" ? " · Segure o clique: chute · Shift: correr · F: curva · Q: dash para o cursor" : " · Empurre o disco para marcar gols"}</span>
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

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
    if (!/^[A-Z0-9]{8}$/.test(requested)) return;
    const timer = setTimeout(async () => {
      console.log(`[Game] Auto-joining room: ${requested}`);
      setMode("online");
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
    }, 8000);
    return () => clearInterval(interval);
  }, [game, activeRoomId, playerId]);

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
      window.history.replaceState({}, "", `/games/${game}?room=${data.room.id}`);
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
      window.history.replaceState({}, "", `/games/${game}?room=${data.room.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar na sala."); }
    finally { setBusy(false); }
  };

  const leaveRoom = async () => {
    if (room && playerId) {
      await fetch(`/api/games/rooms/${room.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, ownerToken, action: "leave" }) }).catch(() => undefined);
      sessionStorage.removeItem(`pedro-games:${game}:${room.id}`);
    }
    window.history.replaceState({}, "", `/games/${game}`);
    setRoom(null); setPlayerId(null); setOwnerToken(null); void loadRooms();
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
      window.history.replaceState({}, "", `/games/${game}`);
    }
  }, [game]);

  const max = game === "haxball" ? 5 : 1;
  return (
    <main className="game-experience shell">
      <div className="game-crumb">
        <Link href="/games"><ArrowLeft size={15} /> Todos os jogos</Link>
        <span>/</span>
        <span>{labels[game]}</span>
      </div>

      <div className="game-page-heading">
        <div>
          <p className="eyebrow"><span /> Playground / {game === "haxball" ? "01" : "02"}</p>
          <h1>{labels[game]}<span>.</span></h1>
          <p>{descriptions[game]}</p>
        </div>
      </div>

      <div className="game-mode-switch" role="tablist" aria-label="Modo de jogo">
        <button role="tab" aria-selected={mode === "bot"} className={mode === "bot" ? "active" : ""} onClick={() => { if (room) void leaveRoom(); setMode("bot"); setError(""); }}>Versus bot</button>
        <button role="tab" aria-selected={mode === "online"} className={mode === "online" ? "active" : ""} onClick={() => { setMode("online"); setError(""); }}>Salas online</button>
      </div>

      {mode === "bot" ? (
        <div className="game-setup">
          <div>
            <span className="game-overline">Partida local</span>
            <h2>{game === "haxball" ? "Monte as equipes" : "Você contra um bot"}</h2>
            <p>{game === "haxball" ? "Escolha quantos bots entram em campo para simular um jogo completo." : "Teste o controle e a física numa partida rápida."}</p>
          </div>
          {game === "haxball" && (
            <div className="bot-counts">
              <label>Aliados (0–4)
                <select value={bots.blue} onChange={(event) => setBots((value) => ({ ...value, blue: Number(event.target.value) }))}>
                  {Array.from({ length: 5 }, (_, index) => <option key={index} value={index}>{index}</option>)}
                </select>
              </label>
              <label>Adversários (1–5)
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
                <div className="game-name-row">
                  <label>Seu nome
                    <input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} placeholder="Nome" />
                  </label>
                  <button type="button" className="button ghost" onClick={() => { if (name.trim().length >= 2) setMode("online"); }}>Salvar</button>
                </div>
              </div>

              <div className="game-room-code-entry">
                <label>Código da sala
                  <input value={roomCode} maxLength={8} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="XXXXXXXX" />
                </label>
                <button type="button" className="button" onClick={() => { if (roomCode) void joinRoom(roomCode); }}>Entrar</button>
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
                  <button type="button" onClick={() => navigator.clipboard.writeText(`${location.origin}/games/${game}?room=${room.id}`)}><Copy size={15} /> Copiar link</button>
                  <button type="button" onClick={() => void leaveRoom()} className="ghost">Sair</button>
                </div>
              </div>

              <div className="game-roster">
                <div>
                  <strong>Equipe branca</strong>
                  {room.players.filter((p) => p.team === "blue").map((p) => (
                    <span key={p.id}>{p.name}{p.id === playerId ? " (você)" : ""}</span>
                  ))}
                </div>
                <div>
                  <strong>Equipe laranja</strong>
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

      {(mode === "bot" || room) && (
        <GameCanvas
          key={`${game}-${mode}-${bots.blue}-${bots.orange}-${room?.id ?? "local"}`}
          game={game}
          mode={mode}
          bots={bots}
          room={room}
          playerId={playerId}
          ownerToken={ownerToken}
          onRoomUpdate={onRoomUpdate}
        />
      )}

      <div className="game-notes">
        <div><Users size={19} /><span>{game === "haxball" ? "Até cinco por equipe nas salas online" : "Um jogador por equipe nas salas online"}</span></div>
        <p>Abra o console (F12) para ver logs de sincronização. O host publica o estado a cada frame e os demais convergem via reconciliação.</p>
      </div>
    </main>
  );
}
