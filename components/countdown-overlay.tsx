"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gameAudio } from "@/lib/game-audio";

export type CountValue = 1 | 2 | 3 | 0 | null;

/**
 * Contagem regressiva de início de partida: 1, 2, 3 e JÁ!, lenta e animada.
 *
 * `frozenRef` trava a simulação enquanto conta (o loop zera o acumulado em
 * vez de avançar). `start()` é idempotente e `cancel()` limpa tudo, usado
 * quando um convidado entra no meio de uma partida já em andamento.
 */
export function useCountdown() {
  const [count, setCount] = useState<CountValue>(null);
  const timers = useRef<number[]>([]);
  const frozenRef = useRef(false);

  const cancel = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    frozenRef.current = false;
    setCount(null);
  }, []);

  const start = useCallback(() => {
    cancel();
    frozenRef.current = true;
    console.info("[Game] Contagem 1-2-3-JÁ iniciada.");
    const steps: Array<[CountValue, number, boolean]> = [
      [1, 350, false],
      [2, 1100, false],
      [3, 1850, false],
      [0, 2600, true],
    ];
    for (const [value, at, final] of steps) {
      timers.current.push(window.setTimeout(() => {
        setCount(value);
        gameAudio.countdownTick(final);
        if (final) {
          timers.current.push(window.setTimeout(() => {
            setCount(null);
            frozenRef.current = false;
          }, 750));
        }
      }, at));
    }
  }, [cancel]);

  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
  }, []);

  return { count, start, cancel, frozenRef };
}

export function CountdownOverlay({ value }: { value: CountValue }) {
  if (value === null) return null;
  return (
    <div className="game-countdown" role="status" aria-live="assertive">
      <span key={String(value)}>{value === 0 ? "JÁ!" : value}</span>
    </div>
  );
}
