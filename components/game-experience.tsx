"use client";

import { ArrowLeft, ArrowRight, Copy, Maximize2, Minimize2, RefreshCcw, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBotGame, createOnlineGame, drawGame, pointerToField, stepGame, updateOnlineRoster, type BotCounts, type GameInput, type GameSnapshot } from "@/lib/game-engine";
import type { GameId, GameRoom, GameTeam } from "@/lib/games";

const labels = { haxball: "Haxball", hoquei: "Hóquei" };
const descriptions = {
  haxball: "Futebol de arena com chute carregado, movimentação e até cinco jogadores por equipe.",
  hoquei: "Hóquei de mesa em uma partida rápida de sete gols. Um jogador por equipe.",
};

type RoomResponse = { room: GameRoom; playerId?: string; player?: { id: string; team: GameTeam } };

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a operação.");
  return result as T;
}

function GameCanvas({ game, mode, bots, room, playerId, onRoomUpdate }: {
  game: GameId;
  mode: "bot" | "online";
  bots: BotCounts;
  room: GameRoom | null;
  playerId: string | null;
  onRoomUpdate: (room: GameRoom | null) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameSnapshot>(createBotGame(game, bots));
  const roomRef = useRef(room);
  const inputRef = useRef<GameInput>({ x: 0, y: 0, sprint: false, kickSeq: 0, aimX: 0, aimY: 0, power: 0, spin: false, kickSpin: false, charging: false });
  const remoteInputsRef = useRef<Record<string, GameInput>>({});
  const lastKicksRef = useRef<Record<string, number>>({});
  const keysRef = useRef<Set<string>>(new Set());
  const pointerDownAt = useRef(0);
  const lastGoalCountRef = useRef(0);
  const hudScoreRef = useRef({ blue: 0, orange: 0 });
  const goalUntilRef = useRef(0);
  const [hud, setHud] = useState({ blue: 0, orange: 0, elapsed: 0, winner: null as GameTeam | null });
  const [goalNotice, setGoalNotice] = useState<{ team: GameTeam; blue: number; orange: number; id: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const roomId = room?.id ?? null;
  const isHost = mode === "online" && room?.players[0]?.id === playerId;

  useEffect(() => { roomRef.current = room; }, [room]);

  useEffect(() => {
    stateRef.current = mode === "online" && roomRef.current
      ? createOnlineGame(game, roomRef.current.players)
      : createBotGame(game, bots);
    lastKicksRef.current = {};
    remoteInputsRef.current = {};
    lastGoalCountRef.current = 0;
    hudScoreRef.current = { blue: 0, orange: 0 };
    goalUntilRef.current = 0;
  }, [game, mode, bots, roomId]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (event: KeyboardEvent) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyF", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) {
        if (document.activeElement === canvas) event.preventDefault();
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
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    let lastTime = performance.now();
    let hudTime = lastTime;
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
      const keys = keysRef.current;
      inputRef.current.x = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      inputRef.current.y = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp"));
      inputRef.current.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
      inputRef.current.spin = keys.has("KeyF");
      if (inputRef.current.charging) inputRef.current.power = Math.min(1, (now - pointerDownAt.current) / 900);

      const currentRoom = roomRef.current;
      const host = mode === "online" && currentRoom?.players[0]?.id === playerId;
      if (mode === "bot") {
        stepGame(stateRef.current, { local: inputRef.current }, lastKicksRef.current, dt);
      } else if (host && currentRoom && currentRoom.players.some((p) => p.team === "blue") && currentRoom.players.some((p) => p.team === "orange")) {
        updateOnlineRoster(stateRef.current, currentRoom.players);
        stepGame(stateRef.current, { ...remoteInputsRef.current, [playerId!]: inputRef.current }, lastKicksRef.current, dt);
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
  }, [game, mode, playerId]);

  useEffect(() => {
    if (mode !== "online" || !roomId || !playerId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      let nextDelay = 150;
      try {
        const base = `/api/games/rooms/${roomId}/state`;
        const currentRoom = roomRef.current;
        const host = currentRoom?.players[0]?.id === playerId;
        const requests: Promise<unknown>[] = [
          fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, action: "input", input: inputRef.current }), cache: "no-store" }),
        ];
        if (host) requests.push(fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, action: "snapshot", snapshot: stateRef.current }), cache: "no-store" }));
        const [stateResponse, ...writes] = await Promise.all([
          fetch(`${base}?game=${game}`, { cache: "no-store" }),
          ...requests,
        ]);
        if (!active) return;
        for (const write of writes) if (write instanceof Response && !write.ok) {
          if (write.status === 404) { active = false; onRoomUpdate(null); return; }
          throw new Error("Conexão com a partida interrompida.");
        }
        if ((stateResponse as Response).status === 404) { active = false; onRoomUpdate(null); return; }
        const state = await readResponse<{ room: GameRoom; snapshot: GameSnapshot | null; inputs: Record<string, GameInput> }>(stateResponse as Response);
        roomRef.current = state.room;
        onRoomUpdate(state.room);
        remoteInputsRef.current = state.inputs;
        if (!host && state.snapshot) stateRef.current = state.snapshot;
        setNetworkError("");
      } catch (error) {
        nextDelay = 1000;
        if (active) setNetworkError(error instanceof Error ? error.message : "Conexão indisponível.");
      } finally {
        if (active) timer = setTimeout(sync, nextDelay);
      }
    };
    void sync();
    return () => { active = false; clearTimeout(timer); };
  }, [game, mode, roomId, playerId, onRoomUpdate]);

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
  return <div ref={boardRef} className="game-board-wrap">
    <div className="game-board-hud">
      <div><span className="score-dot white" /> Branco <strong>{hud.blue}</strong></div>
      <span className="game-timer">{time}</span>
      <div><strong>{hud.orange}</strong> Laranja <span className="score-dot orange" /></div>
      <button type="button" className="game-fullscreen-button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "Sair da tela cheia" : "Colocar jogo em tela cheia"} title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
    </div>
    <div className="game-canvas-shell">
      <canvas ref={canvasRef} tabIndex={0} className="game-canvas" aria-label={`${labels[game]}: use WASD para mover${game === "haxball" ? " e o mouse para chutar" : ""}`} onPointerDown={onPointerDown} onPointerMove={(event) => { if (inputRef.current.charging) updateAim(event); }} onPointerUp={onPointerUp} onPointerCancel={() => { inputRef.current.charging = false; }} onContextMenu={(event) => event.preventDefault()} />
      {mode === "online" && room && !room.players.some((p) => p.team === "orange") && <div className="game-waiting">Aguardando adversário na sala {room.id}</div>}
      {goalNotice && <div key={goalNotice.id} className="game-goal-overlay" role="status"><span>GOOOL</span><strong>{goalNotice.blue} <i>—</i> {goalNotice.orange}</strong><small>Equipe {goalNotice.team === "blue" ? "branca" : "laranja"} marcou</small></div>}
      {hud.winner && !goalNotice && <div className="game-waiting">Equipe {hud.winner === "blue" ? "branca" : "laranja"} venceu.</div>}
    </div>
    <div className="game-board-footer"><span>WASD ou setas: mover {game === "haxball" ? " · Segure o clique: chute · Shift: correr · F: curva" : " · Empurre o disco para marcar"}</span>{(mode === "bot" || isHost) && <button type="button" onClick={reset}><RefreshCcw size={15} /> Reiniciar</button>}</div>
    {networkError && <p className="game-error" role="status">{networkError}</p>}
  </div>;
}

export function GameExperience({ game }: { game: GameId }) {
  const [mode, setMode] = useState<"bot" | "online">("bot");
  const [bots, setBots] = useState<BotCounts>({ blue: 1, orange: 2 });
  const [name, setName] = useState(() => typeof window === "undefined" ? "" : (localStorage.getItem("pedro-games-name") ?? ""));
  const [team, setTeam] = useState<GameTeam>("orange");
  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
    if (!/^[A-Z0-9]{8}$/.test(requested)) return;
    const timer = setTimeout(async () => {
      setMode("online");
      setRoomCode(requested);
      const saved = sessionStorage.getItem(`pedro-games:${game}:${requested}`);
      if (!saved) return;
      try {
        const { playerId: savedId } = JSON.parse(saved) as { playerId: string };
        const response = await fetch(`/api/games/rooms/${requested}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId: savedId, action: "heartbeat" }) });
        const data = await readResponse<RoomResponse>(response);
        setPlayerId(savedId);
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
      localStorage.setItem("pedro-games-name", name.trim());
      const response = await fetch("/api/games/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, name: name.trim() }) });
      const data = await readResponse<RoomResponse>(response);
      setRoom(data.room); setPlayerId(data.playerId ?? null);
      if (data.playerId) sessionStorage.setItem(`pedro-games:${game}:${data.room.id}`, JSON.stringify({ playerId: data.playerId }));
      window.history.replaceState({}, "", `/games/${game}?room=${data.room.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a sala."); }
    finally { setBusy(false); }
  };

  const joinRoom = async (id: string) => {
    if (name.trim().length < 2) { setError("Informe um nome com pelo menos dois caracteres."); return; }
    setBusy(true); setError("");
    try {
      localStorage.setItem("pedro-games-name", name.trim());
      const freshId = crypto.randomUUID();
      const response = await fetch(`/api/games/rooms/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, name: name.trim(), playerId: freshId, team, action: "join" }) });
      const data = await readResponse<RoomResponse>(response);
      setRoom(data.room); setPlayerId(data.player?.id ?? freshId);
      sessionStorage.setItem(`pedro-games:${game}:${data.room.id}`, JSON.stringify({ playerId: data.player?.id ?? freshId }));
      window.history.replaceState({}, "", `/games/${game}?room=${data.room.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar na sala."); }
    finally { setBusy(false); }
  };

  const leaveRoom = async () => {
    if (room && playerId) {
      await fetch(`/api/games/rooms/${room.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, playerId, action: "leave" }) }).catch(() => undefined);
      sessionStorage.removeItem(`pedro-games:${game}:${room.id}`);
    }
    window.history.replaceState({}, "", `/games/${game}`);
    setRoom(null); setPlayerId(null); void loadRooms();
  };

  const onRoomUpdate = useCallback((updated: GameRoom | null) => {
    setRoom(updated);
    if (!updated) {
      setPlayerId(null);
      setError("A sala expirou ou foi encerrada.");
      window.history.replaceState({}, "", `/games/${game}`);
    }
  }, [game]);
  const max = game === "haxball" ? 5 : 1;
  return <main className="game-experience shell">
    <div className="game-crumb"><Link href="/games"><ArrowLeft size={15} /> Todos os jogos</Link><span>/</span><span>{labels[game]}</span></div>
    <div className="game-page-heading"><div><p className="eyebrow"><span /> Playground / {game === "haxball" ? "01" : "02"}</p><h1>{labels[game]}<span>.</span></h1><p>{descriptions[game]}</p></div><span className="game-tag">Canvas 2D / Multiplayer</span></div>
    <div className="game-mode-switch" role="tablist" aria-label="Modo de jogo">
      <button role="tab" aria-selected={mode === "bot"} className={mode === "bot" ? "active" : ""} onClick={() => { if (room) void leaveRoom(); setMode("bot"); setError(""); }}>Versus bot</button>
      <button role="tab" aria-selected={mode === "online"} className={mode === "online" ? "active" : ""} onClick={() => { setMode("online"); setError(""); }}>Salas online</button>
    </div>
    {mode === "bot" ? <div className="game-setup">
      <div><span className="game-overline">Partida local</span><h2>{game === "haxball" ? "Monte as equipes" : "Você contra um bot"}</h2><p>{game === "haxball" ? "Escolha quantos bots entram em cada equipe. Você joga pela equipe branca." : "Controle o taco branco com WASD. O bot controla o taco laranja."}</p></div>
      {game === "haxball" && <div className="bot-counts"><label>Aliados (0–4)<select value={bots.blue} onChange={(event) => setBots((value) => ({ ...value, blue: Number(event.target.value) }))}>{[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}</select></label><label>Adversários (1–5)<select value={bots.orange} onChange={(event) => setBots((value) => ({ ...value, orange: Number(event.target.value) }))}>{[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}</select></label></div>}
    </div> : <div className="game-online-panel">
      {!room ? <>
        <div className="game-online-head"><div><span className="game-overline">Salas públicas</span><h2>Entre em campo.</h2><p>Sem conta. Escolha um nome, crie uma sala ou entre em uma partida disponível.</p></div><div className="game-online-controls"><label>Seu nome<input maxLength={20} value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" /></label><label>Equipe ao entrar<select value={team} onChange={(event) => setTeam(event.target.value as GameTeam)}><option value="blue">Branca</option><option value="orange">Laranja</option></select></label><button className="game-primary-button" type="button" disabled={busy} onClick={createRoom}>Criar sala <ArrowRight size={16} /></button></div></div>
        <div className="game-room-code-entry"><label>Código da sala<input value={roomCode} maxLength={8} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="XXXXXXXX" /></label><button type="button" disabled={busy || !/^[A-Z0-9]{8}$/.test(roomCode)} onClick={() => void joinRoom(roomCode)}>Entrar pelo código <ArrowRight size={15} /></button></div>
        <div className="game-room-list-head"><strong>Salas abertas</strong><button type="button" onClick={() => void loadRooms()}><RefreshCcw size={15} /> Atualizar</button></div>
        <div className="game-room-list">{rooms.length ? rooms.map((entry) => <div className="game-room-card" key={entry.id}><div><span className="game-room-code">#{entry.id}</span><strong>{entry.players[0]?.name ?? "Sala pública"}</strong><small>{entry.players.length} / {max * 2} jogadores</small></div><div className="game-room-teams"><span>Branca {entry.players.filter((player) => player.team === "blue").length}/{max}</span><span>Laranja {entry.players.filter((player) => player.team === "orange").length}/{max}</span></div><button disabled={busy || entry.players.length >= max * 2} onClick={() => void joinRoom(entry.id)}>Entrar <ArrowRight size={16} /></button></div>) : <p className="game-rooms-empty">Nenhuma sala ativa. Crie a primeira.</p>}</div>
      </> : <div className="game-active-room"><div className="game-active-heading"><div><span className="game-overline">Sala pública</span><h2>#{room.id}</h2><p>{room.status === "waiting" ? "Aguardando adversário." : "Partida em andamento."}</p></div><div className="game-room-actions"><button type="button" onClick={() => navigator.clipboard.writeText(`${location.origin}/games/${game}?room=${room.id}`)}><Copy size={15} /> Copiar link</button><button type="button" onClick={() => void leaveRoom()}>Sair da sala</button></div></div><div className="game-roster"><div><strong>Equipe branca</strong>{room.players.filter((p) => p.team === "blue").map((p) => <span key={p.id}>{p.name}{p.id === playerId ? " (você)" : ""}</span>)}<small>{room.players.filter((p) => p.team === "blue").length} / {max}</small></div><div><strong>Equipe laranja</strong>{room.players.filter((p) => p.team === "orange").map((p) => <span key={p.id}>{p.name}{p.id === playerId ? " (você)" : ""}</span>)}<small>{room.players.filter((p) => p.team === "orange").length} / {max}</small></div></div></div>}
      {error && <p role="alert" className="game-error">{error}</p>}
    </div>}
    {(mode === "bot" || room) && <GameCanvas key={`${game}-${mode}-${bots.blue}-${bots.orange}-${room?.id ?? "local"}`} game={game} mode={mode} bots={bots} room={room} playerId={playerId} onRoomUpdate={onRoomUpdate} />}
    <div className="game-notes"><div><Users size={19} /><span>{game === "haxball" ? "Até cinco por equipe nas salas online" : "Um jogador por equipe nas salas online"}</span></div><p>A partida online começa quando houver jogadores nas duas equipes. Salas sem atividade expiram automaticamente.</p></div>
  </main>;
}
