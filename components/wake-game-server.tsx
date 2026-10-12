"use client";

import { useEffect } from "react";
import { wakeGameServer } from "@/lib/game-server";
import { LAN_URL_KEY } from "@/lib/geckos-room";

/**
 * Dispara o wake-up do Render ao entrar na aba de games. Fire-and-forget com
 * retries no servidor (`/api/games/wake`); nunca bloqueia a renderização nem
 * mostra erro. Com servidor LAN salvo, pula o wake: a máquina local já está
 * acordada e o jogo usa o HTTP da mesma origem até o UDP conectar.
 */
export function WakeGameServer() {
  useEffect(() => {
    let cancelled = false;
    try {
      if (window.localStorage.getItem(LAN_URL_KEY)) return;
    } catch {
      // sem acesso ao storage, tenta o wake normal
    }
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
