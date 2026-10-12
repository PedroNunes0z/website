# Servidor UDP das partidas (geckos.io) + salas no Redis: deploy no Render.

## O que é

- `POST /rooms`, `GET /rooms?game=`: salas persistidas no Redis (TCP, `REDIS_URL`).
- `GET /health`: usado pelo Next (`/api/games/wake`) para acordar o serviço
  gratuito do Render quando alguém entra na aba de games.
- geckos.io (UDP/WebRTC): retransmite `input` (~60 Hz) e `snapshot` (~20 Hz)
  dentro da sala. Modelo host-autoritativo, igual ao do site via HTTP.

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

## Jogar na rede local (LAN)

Sem internet e sem Render:

1. Num PC da rede: `cd game-server && npm install && npm run dev` (sobe em `:9208`).
2. Libere a porta `9208` (TCP e UDP) no firewall desse PC.
3. Nos outros aparelhos (mesmo Wi-Fi), abra o jogo, vá em Salas online e informe `http://IP-DO-PC:9208` no bloco Rede local (LAN).
4. Crie ou entre numa sala: inputs e snapshots trafegam em UDP dentro da rede.

Sem `REDIS_URL`, as salas ficam em memória (ok para teste local, sem persistência).

## Protocolo UDP (salas)

Cliente (`@geckos.io/client`) conecta em `NEXT_PUBLIC_GAME_SERVER_URL` e emite:

- `join { roomId, playerId }`: entra na sala UDP.
- `input { playerId, input }`: 60 Hz; servidor retransmite à sala e espelha no Redis.
- `snapshot { snapshot }`: só o host, ~20 Hz; servidor retransmite e persiste.

Sem servidor configurado ou durante o cold start do Render, o jogo usa a
sondagem HTTP automaticamente. Na mesma rede, use o modo LAN abaixo.
