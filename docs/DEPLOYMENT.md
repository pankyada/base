# Deployment Guide

## Option 1 — Local TUI (single command)

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
pnpm install
pnpm tui
```

`pnpm tui` automatically starts the harness server in the background, waits until it's
healthy, then launches the TUI. Quitting the TUI (Ctrl-C) cleanly shuts down the server
it started. If a server is already running on `HARNESS_PORT` (default 7337), it is
reused and left running when the TUI exits.

---

## Option 2 — Raw Docker

Build and run the backend server:

```bash
docker build -t harness-server .
docker run -d \
  -e OPENAI_API_KEY=your-key \
  -e HARNESS_ALLOWED_ORIGINS=http://localhost:3000 \
  -p 7337:7337 \
  -v $(pwd)/.harness-data:/home/harness/.harness \
  harness-server
```

Build and run the frontend:

```bash
docker build -t harness-web ./web
docker run -d \
  -e NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337 \
  -p 3000:3000 \
  harness-web
```

---

## Option 3 — Docker Compose (recommended for full stack)

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
docker compose up
```

The web client will be available at http://localhost:3000.
The backend API is at http://localhost:7337.

Session data, memory, and telemetry are persisted to `.harness-data/` on the host.

### Remote deployments

The web client connects to the backend via WebSocket **from the browser**, not from
the web container. For remote deployments, override the backend URL:

```bash
# In .env or as an environment variable when building the web image:
NEXT_PUBLIC_HARNESS_WS_URL=wss://api.yourdomain.com
```

When using `wss://` (secure WebSocket) ensure your reverse proxy forwards WebSocket
upgrade headers correctly.

### Web client deployment

Deploy the client as a separate Next.js application. Set the Vercel project root
to `web/` (or use `pnpm --filter harness-web build`) and configure
`NEXT_PUBLIC_HARNESS_WS_URL` plus `NEXT_PUBLIC_HARNESS_HTTP_URL` for the
reachable harness server. Add the deployed client origin to
`HARNESS_ALLOWED_ORIGINS`; the client cannot connect until both origin and
optional bearer-key requirements pass.

Set `HARNESS_ALLOWED_ORIGINS` to the exact browser origins allowed to connect. It
defaults to `http://localhost:3000,http://127.0.0.1:3000`; `*` is available only
for an intentionally broad reverse-proxy deployment. `HARNESS_DATASET_MAX_BYTES`
sets the CSV/JSON upload limit and defaults to 100 MB.

### Breaking approval behaviour

`hello.yolo` no longer grants an approval bypass. The server resolves approval
mode from `approval_mode` in the selected profile, `HARNESS_APPROVAL_MODE`, and
the profile-mode ceiling. Browser clients may request a stricter mode only.
Profiles using `mode: analyst` or `mode: assistant` now cap an explicit
`approval_mode: yolo` (or `HARNESS_APPROVAL_MODE=yolo`) at `danger`; no shipped
example profile uses that combination, so their effective behavior is unchanged.
