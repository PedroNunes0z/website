import Ably from "ably";
import { useEffect, useRef, useState } from "react";
import type { GameId } from "@/lib/games";
import { ROOM_EVENT_NAMES, roomChannelName, type RealtimeClientEvent, type RoomEventData } from "@/lib/realtime";

/**
 * Estado da conexão em tempo real exposto à interface.
 * - `fallback`: Ably não configurado ou indisponível — o polling HTTP assume.
 * - `connected`: fluxo em tempo real ativo, polling de leitura suspenso.
 * - demais: o SDK reconecta sozinho com backoff; o polling cobre o intervalo.
 */
export type RealtimeStatus = "idle" | "connecting" | "connected" | "disconnected" | "suspended" | "failed" | "fallback";

interface UseAblyRoomOptions {
  roomId: string | null;
  game: GameId;
  playerId: string | null;
  onEvent: (event: RealtimeClientEvent) => void;
}

class TokenHttpError extends Error {
  constructor(public status: number) {
    super(`token request failed: ${status}`);
  }
}

/**
 * Assina somente o canal da sala atual (`game-room:<roomId>`) usando um token
 * emitido pelo servidor — a `ABLY_API_KEY` nunca chega ao navegador.
 * Reconexão automática com backoff fica a cargo do SDK oficial
 * (`disconnectedRetryTimeout` / `suspendedRetryTimeout`); ao reconectar, o
 * hook dispara um evento `resync` para corrigir eventos perdidos.
 * Cleanup completo: unsubscribe dos listeners, detach do canal e close do
 * cliente ao sair da sala ou trocar de sala (evita listeners duplicados).
 */
export function useAblyRoom({ roomId, game, playerId, onEvent }: UseAblyRoomOptions): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!roomId || !playerId) return;
    let disposed = false;
    let client: Ably.Realtime | null = null;
    let listener: ((message: Ably.Message) => void) | null = null;
    const pendingTimers: Array<ReturnType<typeof setTimeout>> = [];

    const emit = (event: RealtimeClientEvent) => {
      if (!disposed) onEventRef.current(event);
    };
    const updateStatus = (next: RealtimeStatus) => {
      if (!disposed) setStatus(next);
    };

    const fetchTokenRequest = async (): Promise<Ably.TokenRequest> => {
      const response = await fetch(`/api/games/rooms/${roomId}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game, playerId }),
        cache: "no-store",
      });
      if (!response.ok) throw new TokenHttpError(response.status);
      return (await response.json()) as Ably.TokenRequest;
    };

    const connect = async () => {
      updateStatus("connecting");
      // Sonda inicial com backoff exponencial: se o Ably não estiver configurado
      // (503) ou a sala for inválida (4xx), cai direto para o fallback HTTP sem
      // criar reconexões em loop.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (disposed) return;
        try {
          await fetchTokenRequest();
          break;
        } catch (error) {
          if (error instanceof TokenHttpError && (error.status === 503 || (error.status < 500 && error.status !== 429))) {
            updateStatus("fallback");
            return;
          }
          if (attempt === 2) {
            updateStatus("fallback");
            return;
          }
          await new Promise<void>((resolve) => pendingTimers.push(setTimeout(resolve, 500 * 2 ** attempt)));
        }
      }
      if (disposed) return;

      client = new Ably.Realtime({
        authCallback: async (_params, callback) => {
          try {
            callback(null, await fetchTokenRequest());
          } catch {
            callback("Não foi possível renovar o token de tempo real.", null);
          }
        },
        autoConnect: true,
        disconnectedRetryTimeout: 3000,
        suspendedRetryTimeout: 10_000,
      });

      let previouslyConnected = false;
      client.connection.on((change: Ably.ConnectionStateChange) => {
        switch (change.current) {
          case "connected": {
            updateStatus("connected");
            // Sincronização inicial e ressincronização pós-queda: corrige
            // qualquer evento perdido buscando o estado autoritativo via API.
            emit({ type: "resync", reason: previouslyConnected ? "reconnected" : "connected" });
            previouslyConnected = true;
            break;
          }
          case "connecting":
          case "initialized":
            updateStatus("connecting");
            break;
          case "disconnected":
            updateStatus("disconnected");
            break;
          case "suspended":
            updateStatus("suspended");
            break;
          case "failed":
          case "closed":
            updateStatus("failed");
            break;
          default:
            break;
        }
      });

      const channel = client.channels.get(roomChannelName(roomId));
      listener = (message: Ably.Message) => {
        emit({ type: "message", name: message.name ?? "", data: (message.data ?? null) as RoomEventData | null });
      };
      for (const name of ROOM_EVENT_NAMES) channel.subscribe(name, listener);
    };

    void connect();

    return () => {
      disposed = true;
      for (const timer of pendingTimers) clearTimeout(timer);
      const current = client;
      client = null;
      if (current) {
        try {
          if (listener) {
            for (const channel of Object.values(current.channels.all as Record<string, Ably.RealtimeChannel>)) {
              channel.unsubscribe(listener);
              void channel.detach().catch(() => undefined);
            }
          }
        } catch {
          // conexão liberada logo abaixo
        }
        current.close();
      }
    };
  }, [roomId, game, playerId]);

  return roomId && playerId ? status : "idle";
}
