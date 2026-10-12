# Servidor UDP das partidas (geckos.io) + salas no Redis — deploy no Render.

## O que é

- `POST /rooms`, `GET /rooms?game=` — salas persistidas no Redis (TCP, `REDIS_URL`).
- `GET /health` — usado pelo Next (`/api/games/wake`) para acordar o serviço
  gratuito do Render quando alguém entra na aba de games.
- geckos.io (UDP/WebRTC) — retransmite `input` (~60 Hz) e `snapshot` (~20 Hz)
  dentro da sala. Modelo host-autoritativo, igual ao atual via Ably/HTTP.

## Deploy no Render

1. Crie um Redis (Render Key Value ou Upstash com URL TCP `rediss://`).
2. New → Web Service → aponte para este repo (usa o `render.yaml` da raiz).
3. Env vars: `REDIS_URL`, `CORS_ORIGIN=https://seu-dominio`.
4. No site (Vercel), defina:
   - `NEXT_PUBLIC_GAME_SERVER_URL=https://portfolio-games-udp.onrender.com`
   - `GAME_SERVER_URL` (mesmo valor, server-side para o wake-up).

## Rodar local

```bash
cd game-server
npm install
REDIS_URL=redis://localhost:6379 CORS_ORIGIN=http://localhost:3000 npm run dev
```

Sem `REDIS_URL`, as salas ficam em memória (ok para teste local, sem persistência).

## Protocolo UDP (salas)

Cliente (`@geckos.io/client`) conecta em `NEXT_PUBLIC_GAME_SERVER_URL` e emite:

- `join { roomId, playerId }` — entra na sala UDP.
- `input { playerId, input }` — 60 Hz; servidor retransmite à sala e espelha no Redis.
- `snapshot { snapshot }` — só o host, ~20 Hz; servidor retransmite e persiste.

Sem servidor configurado ou durante o cold start do Render, o jogo usa o
transporte atual (Ably + polling HTTP) automaticamente.
