# Simplified Deployment & Usage — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-05-31
> **Roadmap item:** #13

---

## Goal

Make the harness trivial to run. Today a TUI session needs two terminals (server + TUI) and there is no container story. This adds: (1) a **single-command TUI** that bootstraps its own server, (2) **Dockerfiles** for backend and frontend, and (3) a **docker-compose** stack that runs both together.

---

## Architecture

Three independent deliverables, no shared runtime code beyond the new bootstrap module:

1. **TUI bootstrap** — `src/tui/bootstrap.ts` manages server lifecycle; `src/tui/index.tsx` calls it before rendering. Auto-spawn + reuse: probe `/health`, spawn a server child only if none is running, tear down only what it spawned.
2. **Backend Dockerfile** — multi-stage Node image running `dist/server/index.js`.
3. **Frontend Dockerfile** — multi-stage Next.js standalone image.
4. **docker-compose.yml** — wires `server` + `web`, browser connects to the published backend port.

---

## Component 1: TUI Single-Command Launcher

### `src/tui/bootstrap.ts` (new)

Exported functions:

```typescript
export interface BootstrapResult {
  spawnedByUs: boolean
  cleanup: () => void
}

export function resolveServerCommand(): { command: string; args: string[] }
export async function ensureServer(port: number): Promise<BootstrapResult>
```

**`ensureServer(port)` logic:**
1. Probe `GET http://localhost:{port}/health`.
   - 200 → server already running. Return `{ spawnedByUs: false, cleanup: () => {} }`.
2. Not reachable → spawn a server child via `resolveServerCommand()`.
3. Poll `/health` every 250ms, up to a 10s deadline.
   - Healthy → return `{ spawnedByUs: true, cleanup }` where `cleanup` kills the child (SIGTERM, then SIGKILL after a 2s grace).
   - Deadline exceeded → kill child, reject with `Error('harness server failed to become healthy within 10s')`.

**`resolveServerCommand()` logic (runtime detection):**
- If running from a compiled binary (detected via `process.execPath` basename being `harness-tui`, or `import.meta.url` resolving inside `bin/`), return the sibling binary: `{ command: <dir>/harness-server, args: [] }`.
- Otherwise (dev, run via `tsx`), return `{ command: 'tsx', args: [<repoRoot>/src/server/index.ts] }`.
- The server entry path / sibling binary path is resolved relative to the bootstrap module's own location (`import.meta.url`), not `process.cwd()`.

### `src/tui/index.tsx` (modify)

```tsx
import React from 'react'
import { render } from 'ink'
import { App } from './app.js'
import { ensureServer } from './bootstrap.js'

const port = parseInt(process.env.HARNESS_PORT ?? '7337')

const { cleanup } = await ensureServer(port)

const instance = render(<App />)

const shutdown = () => { cleanup(); instance.unmount() }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
instance.waitUntilExit().then(() => cleanup())
```

### `package.json` (modify)

Add: `"tui": "tsx src/tui/index.tsx"`

`pnpm tui` is now the entire experience. The compiled `bin/harness-tui` inherits the same bootstrap behavior because the logic lives in source.

---

## Component 2: Backend Dockerfile (repo root)

Multi-stage:

```dockerfile
# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile --filter harness...
COPY src ./src
COPY profiles ./profiles
COPY prompts ./prompts
RUN pnpm build

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable && useradd -m -u 1000 harness
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --filter harness... && pnpm store prune
COPY --from=build /app/dist ./dist
COPY profiles ./profiles
COPY prompts ./prompts
USER harness
ENV HARNESS_PORT=7337
EXPOSE 7337
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "require('http').get('http://localhost:7337/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
```

### `.dockerignore` (repo root, new)

```
node_modules
web
dist
bin
.git
tests
**/*.test.ts
.harness-data
```

---

## Component 3: Frontend Dockerfile (`web/Dockerfile`)

Multi-stage, leverages Next.js standalone output:

```dockerfile
# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN useradd -m -u 1000 harness
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# (no public/ dir in this project; add a COPY for it here if one is introduced)
USER harness
EXPOSE 3000
CMD ["node", "server.js"]
```

### `web/next.config.ts` (modify)

Add `output: 'standalone'` so the runtime image only ships the minimal server bundle.

### `web/.dockerignore` (new)

```
node_modules
.next
.git
```

---

## Component 4: docker-compose.yml (repo root)

```yaml
services:
  server:
    build: .
    image: harness-server
    ports:
      - "7337:7337"
    env_file:
      - .env
    environment:
      - HARNESS_PORT=7337
    volumes:
      - ./.harness-data:/home/harness/.harness
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:7337/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5

  web:
    build: ./web
    image: harness-web
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337
    depends_on:
      server:
        condition: service_healthy
```

**Persistence (Q4=B):** the container's harness home (`/home/harness/.harness`) is bind-mounted to `./.harness-data` on the host — sessions, memory, usage ledger, and telemetry persist across restarts and are inspectable on the host. `.harness-data` is gitignored.

**WS URL note:** `NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337` works for local compose because the **browser** (not the web container) opens the WebSocket, resolving `localhost:7337` against the host where the backend port is published. For remote deployments this must be overridden to the backend's public address. Documented in `docs/DEPLOYMENT.md`.

---

## Component 5: Supporting Files

- **`.env.example`** (repo root, new) — documents required vars:
  ```
  # LLM provider key — name must match profile.model.api_key_env
  OPENAI_API_KEY=
  # Optional: bearer token to authenticate REST endpoints
  HARNESS_API_KEY=
  # Server port (default 7337)
  HARNESS_PORT=7337
  # Browser → backend WebSocket URL (override for remote deploys)
  NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337
  ```
- **`.gitignore`** (modify) — add `.env` and `.harness-data/`.
- **`docs/DEPLOYMENT.md`** (new) — three deployment paths:
  1. **Local TUI** — `pnpm tui` (single command, auto-spawns server)
  2. **Raw Docker** — `docker build`/`docker run` for each image
  3. **Compose** — `docker compose up`, with the remote-WS-URL override note

---

## Files Created / Modified

| Status | Path | Change |
|--------|------|--------|
| Create | `src/tui/bootstrap.ts` | Server lifecycle: `ensureServer`, `resolveServerCommand` |
| Modify | `src/tui/index.tsx` | Call `ensureServer` before render; wire cleanup |
| Modify | `package.json` | Add `tui` script |
| Create | `Dockerfile` | Backend multi-stage image |
| Create | `.dockerignore` | Backend build exclusions |
| Create | `web/Dockerfile` | Frontend multi-stage image |
| Modify | `web/next.config.ts` | `output: 'standalone'` |
| Create | `web/.dockerignore` | Frontend build exclusions |
| Create | `docker-compose.yml` | `server` + `web` stack |
| Create | `.env.example` | Documented required env vars |
| Modify | `.gitignore` | Ignore `.env`, `.harness-data/` |
| Create | `docs/DEPLOYMENT.md` | Three deployment paths |

---

## Testing Strategy

- **`tests/tui-bootstrap.test.ts`** — unit tests for the bootstrap module:
  - **reuse path** — mock `/health` → 200; `ensureServer` returns `spawnedByUs: false`, no child process spawned
  - **spawn path** — mock health fail then succeed after N polls; `ensureServer` spawns child, returns `spawnedByUs: true`
  - **`resolveServerCommand` dev** — in tsx/dev context returns `{ command: 'tsx', args: [<.../src/server/index.ts>] }`
  - **`resolveServerCommand` compiled** — in binary context returns the sibling `harness-server` command
  - **cleanup** — kills the child only when `spawnedByUs === true`; no-op when reusing
  - **timeout** — health never becomes ready → rejects with the 10s timeout error and kills the child

  HTTP probing and `child_process.spawn` are mocked — no real server or Docker needed.

- **Docker / compose** — validated via build-and-smoke steps in the implementation plan (not unit tests):
  - `docker compose config` parses cleanly
  - `docker compose up -d` → `curl localhost:7337/health` returns 200 → `curl localhost:3000` returns the web shell
