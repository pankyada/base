# Simplified Deployment & Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the harness trivial to run: `pnpm tui` auto-spawns the server, and `docker compose up` runs the full stack.

**Architecture:** A new `src/tui/bootstrap.ts` module probes `/health`, spawns a server child if not running, and cleans up on exit; `src/tui/index.tsx` calls it before rendering. Two multi-stage Dockerfiles (backend + Next.js) and a `docker-compose.yml` complete the container story.

**Tech Stack:** TypeScript, Node.js `child_process.spawn`, native `fetch` (Node 18+), Docker multi-stage builds, Next.js standalone output, pnpm workspaces, Vitest

---

## File Map

| Status | Path | Responsibility |
|--------|------|---------------|
| Create | `src/tui/bootstrap.ts` | `ensureServer`, `resolveServerCommand`, health probe, child lifecycle |
| Modify | `src/tui/index.tsx` | Call `ensureServer` before render, wire cleanup |
| Modify | `package.json` | Add `tui` script |
| Create | `tests/tui-bootstrap.test.ts` | Unit tests for bootstrap module |
| Create | `Dockerfile` | Backend multi-stage Node image |
| Create | `.dockerignore` | Backend build exclusions |
| Create | `web/Dockerfile` | Frontend multi-stage Next.js standalone image |
| Modify | `web/next.config.ts` | Add `output: 'standalone'` |
| Create | `web/.dockerignore` | Frontend build exclusions |
| Create | `docker-compose.yml` | `server` + `web` services |
| Create | `.env.example` | Documents required env vars |
| Modify | `.gitignore` | Add `.harness-data/` |
| Create | `docs/DEPLOYMENT.md` | Three deployment paths |

---

## Task 1: Bootstrap module

**Files:**
- Create: `src/tui/bootstrap.ts`
- Create: `tests/tui-bootstrap.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tui-bootstrap.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'

// We import after mocking so the module picks up mocked fetch/spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>

function makeFakeChild(exitAfterMs?: number) {
  const child: any = { kill: vi.fn(), pid: 1234 }
  if (exitAfterMs !== undefined) {
    setTimeout(() => child.emit?.('close', 0), exitAfterMs)
  }
  return child
}

function mockFetch(responses: Array<{ ok: boolean; status: number } | 'throw'>) {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]
    if (r === 'throw') throw new Error('connection refused')
    return { ok: r.ok, status: r.status }
  }))
}

describe('ensureServer', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('reuses existing server — no child spawned, spawnedByUs false', async () => {
    mockFetch([{ ok: true, status: 200 }])

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const result = await ensureServer(7337)

    expect(result.spawnedByUs).toBe(false)
    expect(mockSpawn).not.toHaveBeenCalled()
    result.cleanup()  // no-op, no error
  })

  it('spawns server when not running, returns spawnedByUs true', async () => {
    // First call: not healthy. Second call (after spawn): healthy.
    mockFetch(['throw', { ok: true, status: 200 }])
    mockSpawn.mockReturnValue(makeFakeChild())

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const resultPromise = ensureServer(7337)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.spawnedByUs).toBe(true)
    expect(mockSpawn).toHaveBeenCalledOnce()
  })

  it('cleanup kills the spawned child', async () => {
    mockFetch(['throw', { ok: true, status: 200 }])
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const resultPromise = ensureServer(7337)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    result.cleanup()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('rejects with timeout error if server never becomes healthy', async () => {
    mockFetch(['throw'])  // always throws
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const resultPromise = ensureServer(7337)
    // Advance past the 10s deadline
    await vi.advanceTimersByTimeAsync(11_000)

    await expect(resultPromise).rejects.toThrow('failed to become healthy within 10s')
    expect(child.kill).toHaveBeenCalled()
  })
})

describe('resolveServerCommand', () => {
  it('returns tsx command in dev context (src/ present)', async () => {
    const { resolveServerCommand } = await import('../src/tui/bootstrap.js')
    // When running tests from src/, isDev=true
    const cmd = resolveServerCommand(true)
    expect(cmd.command).toBe('tsx')
    expect(cmd.args[0]).toContain('src/server/index.ts')
  })

  it('returns sibling harness-server in compiled context', async () => {
    const { resolveServerCommand } = await import('../src/tui/bootstrap.js')
    const cmd = resolveServerCommand(false)
    expect(cmd.command).toContain('harness-server')
    expect(cmd.args).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/tui-bootstrap.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/tui/bootstrap.ts`**

```typescript
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export interface BootstrapResult {
  spawnedByUs: boolean
  cleanup: () => void
}

async function probeHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.status === 200
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function findRepoRoot(fromPath: string): string {
  let dir = dirname(fromPath)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  return dir
}

export function resolveServerCommand(isDev?: boolean): { command: string; args: string[] } {
  const thisFile = fileURLToPath(import.meta.url)
  const repoRoot = findRepoRoot(thisFile)
  const dev = isDev ?? existsSync(join(repoRoot, 'src', 'server', 'index.ts'))

  if (dev) {
    return { command: 'tsx', args: [join(repoRoot, 'src', 'server', 'index.ts')] }
  } else {
    const dir = dirname(thisFile)
    return { command: join(dir, 'harness-server'), args: [] }
  }
}

export async function ensureServer(port: number): Promise<BootstrapResult> {
  if (await probeHealth(port)) {
    return { spawnedByUs: false, cleanup: () => {} }
  }

  const { command, args } = resolveServerCommand()
  const child = spawn(command, args, {
    env: { ...process.env },
    stdio: 'ignore',
    detached: false,
  })

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    await sleep(250)
    if (await probeHealth(port)) {
      const cleanup = () => {
        child.kill('SIGTERM')
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* already dead */ }
        }, 2000)
      }
      return { spawnedByUs: true, cleanup }
    }
  }

  child.kill('SIGKILL')
  throw new Error(
    `harness server failed to become healthy within 10s on port ${port} — ` +
    `check that '${command}' is on your PATH and the profile is valid`
  )
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/tui-bootstrap.test.ts
```
Expected: all 6 tests PASS

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/tui/bootstrap.ts tests/tui-bootstrap.test.ts
git commit -m "feat: add TUI bootstrap module — auto-spawn server with health probe"
```

---

## Task 2: TUI entry + pnpm script

**Files:**
- Modify: `src/tui/index.tsx`
- Modify: `package.json`

- [ ] **Step 1: Replace `src/tui/index.tsx`**

```tsx
import React from 'react'
import { render } from 'ink'
import { App } from './app.js'
import { ensureServer } from './bootstrap.js'

const port = parseInt(process.env.HARNESS_PORT ?? '7337')

const { cleanup } = await ensureServer(port)

const instance = render(<App />)

const shutdown = () => { cleanup(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
instance.waitUntilExit().then(() => { cleanup() })
```

- [ ] **Step 2: Add `tui` script to `package.json`**

In the `scripts` block, add:
```json
"tui": "tsx src/tui/index.tsx",
```

- [ ] **Step 3: Smoke-test single command**

```bash
# Start and immediately Ctrl-C to verify it boots and tears down cleanly
HARNESS_PORT=7338 pnpm tui
```
Expected: server spawns (you'll see `Harness server on ws://localhost:7338`), TUI renders, Ctrl-C cleanly kills both.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/tui/index.tsx package.json
git commit -m "feat: pnpm tui — single-command TUI with auto-server bootstrap"
```

---

## Task 3: Backend Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
web
dist
bin
.git
tests
**/*.test.ts
.harness-data
*.md
ui-designs
.antigravitycli
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile --filter . --ignore-workspace
COPY src ./src
COPY profiles ./profiles
COPY prompts ./prompts
RUN pnpm build

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable && useradd -m -u 1000 harness
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --filter . --ignore-workspace && pnpm store prune
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

- [ ] **Step 3: Build and verify**

```bash
docker build -t harness-server .
```
Expected: build succeeds, two stages complete

- [ ] **Step 4: Smoke-run the image**

```bash
docker run --rm -e OPENAI_API_KEY=test -p 7337:7337 harness-server &
sleep 3
curl -s http://localhost:7337/health
docker stop $(docker ps -q --filter ancestor=harness-server)
```
Expected: `/health` returns `{"status":"ok",...}` (or similar JSON)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add backend multi-stage Dockerfile"
```

---

## Task 4: Frontend Dockerfile

**Files:**
- Create: `web/Dockerfile`
- Create: `web/.dockerignore`
- Modify: `web/next.config.ts`

- [ ] **Step 1: Enable Next.js standalone output in `web/next.config.ts`**

```typescript
import type { NextConfig } from 'next'
const config: NextConfig = {
  output: 'standalone',
}
export default config
```

- [ ] **Step 2: Create `web/.dockerignore`**

```
node_modules
.next
.git
```

- [ ] **Step 3: Create `web/Dockerfile`**

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
USER harness
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "server.js"]
```

- [ ] **Step 4: Build and verify**

```bash
docker build -t harness-web ./web
```
Expected: build succeeds

- [ ] **Step 5: Smoke-run the frontend image**

```bash
docker run --rm -p 3000:3000 -e NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337 harness-web &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
docker stop $(docker ps -q --filter ancestor=harness-web)
```
Expected: HTTP status `200`

- [ ] **Step 6: Commit**

```bash
git add web/Dockerfile web/.dockerignore web/next.config.ts
git commit -m "feat: add frontend multi-stage Dockerfile with Next.js standalone output"
```

---

## Task 5: docker-compose + env files

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create `docker-compose.yml`**

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

- [ ] **Step 2: Create `.env.example`**

```bash
# LLM provider key — name must match profile.model.api_key_env
OPENAI_API_KEY=

# Optional: bearer token to authenticate REST endpoints
HARNESS_API_KEY=

# Server port (default 7337)
HARNESS_PORT=7337

# Browser → backend WebSocket URL.
# For local compose: ws://localhost:7337 (browser resolves against the host).
# For remote deploys: override to the backend's public address, e.g. wss://api.example.com
NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337
```

- [ ] **Step 3: Add `.harness-data/` to `.gitignore`**

Current `.gitignore` contains several entries. Add to the end:
```
.harness-data/
```

- [ ] **Step 4: Validate compose config**

```bash
docker compose config
```
Expected: prints the resolved compose file with no errors

- [ ] **Step 5: Full smoke test**

```bash
# Copy example env and set a key
cp .env.example .env
echo "OPENAI_API_KEY=test-key" >> .env

docker compose up -d
sleep 15  # wait for health checks
curl -s http://localhost:7337/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
docker compose down
```
Expected: `/health` returns JSON with status ok; web returns `200`

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "feat: add docker-compose.yml, .env.example, persist .harness-data to host"
```

---

## Task 6: DEPLOYMENT.md + ROADMAP

**Files:**
- Create: `docs/DEPLOYMENT.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Create `docs/DEPLOYMENT.md`**

```markdown
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
```

- [ ] **Step 2: Mark #13 as done in `docs/ROADMAP.md`**

Change `### ❌ 13.` to `### ✅ 13.` and replace the `**Status:**` line with:
```markdown
**What shipped:** `pnpm tui` single-command launcher (auto-spawns server), backend `Dockerfile`, frontend `web/Dockerfile`, `docker-compose.yml` with bind-mounted persistence, `.env.example`, `docs/DEPLOYMENT.md`.
```

Update the sequencing block:
```
❌ #13 Simplified deployment  ← spec + plan ready; independent, can ship anytime
```
to:
```
✅ #13 Simplified deployment
```

- [ ] **Step 3: Commit and push**

```bash
git add docs/DEPLOYMENT.md docs/ROADMAP.md
git commit -m "feat: add DEPLOYMENT.md, mark #13 done in ROADMAP"
git push
```
