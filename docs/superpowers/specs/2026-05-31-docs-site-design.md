# Docs Site (GitHub Pages) Design

> Feature #10 from ROADMAP.md

**Goal:** Ship a VitePress docs site at `pankyada.github.io/base` covering everything a developer needs to discover, configure, and extend the harness — with a landing page for new visitors and full reference for active builders.

**Architecture:** VitePress installed as a root dev dependency. Source lives in `docs/` (standard VitePress convention). Existing `docs/DEPLOYMENT.md` and `docs/ROADMAP.md` are reused as pages. `docs/superpowers/` is excluded from the build via VitePress config. GitHub Actions deploys on every push to `main` using the Pages environment (no `gh-pages` branch).

**Tech Stack:** VitePress · GitHub Actions (`actions/upload-pages-artifact` + `actions/deploy-pages`) · pnpm

---

## 1. VitePress setup

- Install `vitepress` as a root devDependency
- Add scripts to root `package.json`:
  - `docs:dev` — `vitepress dev docs`
  - `docs:build` — `vitepress build docs`
  - `docs:preview` — `vitepress preview docs`
- Config at `docs/.vitepress/config.ts`:
  - `base: '/base/'` — required for correct asset paths on `pankyada.github.io/base`
  - Theme: VitePress default dark
  - `srcExclude: ['superpowers/**']` — hides internal planning files from the build
  - Top nav: `Docs` · `GitHub` (links to `https://github.com/pankyada/base`) · `Changelog`
  - Built-in search enabled (`search: { provider: 'local' }`)
- `docs/.vitepress/cache/` and `docs/.vitepress/dist/` added to `.gitignore` (see section 6); the config itself is committed

---

## 2. Site structure

### Landing page — `docs/index.md`

VitePress hero layout:
- Title: "Harness"
- Tagline: "A thin WebSocket runtime that wires an LLM to tools, skills, memory, and hooks. Everything profile-driven."
- Actions: "Get Started" (→ quick-start) · "GitHub"
- Feature cards (4): Profile-driven · Pluggable tools · ACL modes · Multi-client

### Sidebar sections

| Group | Pages |
|-------|-------|
| **Introduction** | What is Harness? · Quick Start · Concepts |
| **Configuration** | Profiles (YAML reference) · Instance Modes · Hooks |
| **Tools & Skills** | Built-in Tools · Skills · MCP Servers · Code Execution |
| **Memory** | Overview & Scopes · FS Provider · Graph Provider |
| **Advanced** | Multi-agent Composition · A2A / ACP Interop · Triggers · Self-improvement · Telemetry |
| **Clients** | TUI (terminal) · Web Client · REST API |
| **Deployment** | Local TUI · Docker / Compose (reuses `docs/DEPLOYMENT.md`) |
| **Changelog** | Reuses `docs/ROADMAP.md` |

### File layout

```
docs/
  index.md                          ← hero landing
  .vitepress/
    config.ts
  guide/
    what-is-harness.md
    quick-start.md
    concepts.md
  configuration/
    profiles.md
    instance-modes.md
    hooks.md
  tools/
    builtin-tools.md
    skills.md
    mcp-servers.md
    code-execution.md
  memory/
    overview.md
    fs-provider.md
    graph-provider.md
  advanced/
    multi-agent.md
    interop.md
    triggers.md
    self-improvement.md
    telemetry.md
  clients/
    tui.md
    web-client.md
    rest-api.md
  ROADMAP.md                        ← already exists; wired as Changelog page
  DEPLOYMENT.md                     ← already exists; wired directly into Deployment sidebar group
  superpowers/                      ← excluded from build (srcExclude)
```

---

## 3. Content quality standard

Every page follows: **one-sentence summary → working code example → full reference**.

- **Quick Start**: developer running in < 5 minutes — install → `.env` → `pnpm tui` → first conversation
- **Profile YAML reference**: annotated full example first, field-by-field table second
- **Built-in tools**: scannable table (name · description · default ACL · example) + expandable per-tool detail
- **Callout blocks**: `:::tip` / `:::warning` / `:::danger` used for gotchas (e.g. "production mode without contract logs a warning at startup")
- **No orphaned pages**: every page reachable from sidebar

---

## 4. GitHub Actions workflow

File: `.github/workflows/docs.yml`

```yaml
name: Deploy docs

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm docs:build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

No `gh-pages` branch is created. GitHub manages the deployment internally via the Pages environment.

---

## 5. Local dev

```bash
pnpm docs:dev      # hot-reload preview at localhost:5173
pnpm docs:build    # build to docs/.vitepress/dist/
pnpm docs:preview  # serve built output locally
```

---

## 6. `.gitignore` additions

```
docs/.vitepress/cache/
docs/.vitepress/dist/
.superpowers/
```
