"use client";

import { useEffect } from "react";
import { wakeGameServer } from "@/lib/game-server";

/**
 * Dispara o wake-up do Render ao entrar na aba de games. Fire-and-forget com
 * retries no servidor (`/api/games/wake`); nunca bloqueia a renderização nem
 * mostra erro — o jogo funciona em fallback HTTP/Ably até o UDP acordar.
 */
export function WakeGameServer() {
  useEffect(() => {
    let cancelled = false;
    void wakeGameServer().then((result) => {
      if (!cancelled && process.env.NODE_ENV === "development") {
        console.info("[games] wake render:", result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
