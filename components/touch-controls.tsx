"use client";

import { useRef, type MutableRefObject } from "react";
import type { GameId } from "@/lib/games";

export interface TouchState {
  x: number;
  y: number;
  active: boolean;
}

interface TouchControlsProps {
  game: GameId;
  touchRef: MutableRefObject<TouchState>;
  keysRef: MutableRefObject<Set<string>>;
  onKick: () => void;
  onDash: () => void;
}

/**
 * HUD mobile: analógico virtual à esquerda e botões à direita (só FutBR).
 * Aparece apenas em aparelhos com ponteiro touch (`pointer: coarse`).
 *
 * O analógico escreve direto no `touchRef`, que o loop do jogo prefere às
 * teclas quando ativo. O botão CORRER segura um Shift virtual no `keysRef`,
 * então o loop não precisa de nenhum caso especial para ele.
 */
export function TouchControls({ game, touchRef, keysRef, onKick, onDash }: TouchControlsProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);

  const steer = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    const stick = stickRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = (clientX - (rect.left + radius)) / radius;
    let dy = (clientY - (rect.top + radius)) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    if (Math.hypot(dx, dy) < 0.15) {
      dx = 0;
      dy = 0;
    }
    touchRef.current = { x: dx, y: dy, active: true };
    if (stick) stick.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
  };

  const release = () => {
    touchRef.current = { x: 0, y: 0, active: false };
    if (stickRef.current) stickRef.current.style.transform = "translate(0px, 0px)";
  };

  return (
    <div className="touch-controls" aria-label="Controles de toque">
      <div
        ref={padRef}
        className="touch-pad"
        role="application"
        aria-label="Analógico: arraste para mover"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          steer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.buttons > 0) steer(event.clientX, event.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div ref={stickRef} className="touch-stick" aria-hidden="true" />
      </div>
      {game === "haxball" && (
        <div className="touch-buttons">
          <button
            type="button"
            className="touch-btn touch-run"
            aria-label="Segure para correr"
            onPointerDown={() => keysRef.current.add("ShiftLeft")}
            onPointerUp={() => keysRef.current.delete("ShiftLeft")}
            onPointerCancel={() => keysRef.current.delete("ShiftLeft")}
            onPointerLeave={() => keysRef.current.delete("ShiftLeft")}
            onContextMenu={(event) => event.preventDefault()}
          >
            CORRER
          </button>
          <button
            type="button"
            className="touch-btn touch-dash"
            aria-label="Dash"
            onPointerDown={(event) => {
              event.preventDefault();
              onDash();
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            DASH
          </button>
          <button
            type="button"
            className="touch-btn touch-kick"
            aria-label="Chutar"
            onPointerDown={(event) => {
              event.preventDefault();
              onKick();
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            CHUTAR
          </button>
        </div>
      )}
    </div>
  );
}
