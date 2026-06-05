# Docs Site Design (Feature #10)

**Date:** 2026-06-05
**Status:** Approved
**Purpose:** Comprehensive public-facing product documentation hosted on GitHub Pages

---

## Goal

Build a VitePress docs site at `pankyada.github.io/base/` covering everything a developer needs to understand, configure, and extend the harness. Auto-deployed on every push to `main` via GitHub Actions.

---

## Repository Structure

```
docs-site/
  package.json          # name: harness-docs, scripts: dev/build/preview
  index.md              # homepage / hero
  getting-started.md
  profiles.md
  builtin-tools.md
  skills.md
  memory.md
  mcp-servers.md
  multi-agent.md
  hooks.md
  self-improvement.md
  telemetry.md
  cli-tui.md
  .vitepress/
    config.ts           # nav, sidebar, search, base path
.github/
  workflows/
    docs.yml            # push to main → build → deploy gh-pages
```

`docs-site/` added to `pnpm-workspace.yaml`. Content Markdown files live at `docs-site/` root (standard VitePress layout — no `srcDir` override needed, output goes to `docs-site/.vitepress/dist`). Existing `docs/` (ROADMAP, DEPLOYMENT, superpowers plans) left untouched.

---

## VitePress Configuration

```ts
// docs-site/.vitepress/config.ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Harness',
  description: 'A WebSocket-based agent harness',
  base: '/base/',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/profiles' },
    ],
    sidebar: [
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Reference',
        items: [
          { text: 'Profiles', link: '/profiles' },
          { text: 'Built-in Tools', link: '/builtin-tools' },
          { text: 'Skills', link: '/skills' },
          { text: 'Memory', link: '/memory' },
          { text: 'MCP Servers', link: '/mcp-servers' },
          { text: 'Multi-Agent', link: '/multi-agent' },
          { text: 'Hooks', link: '/hooks' },
          { text: 'Self-Improvement', link: '/self-improvement' },
          { text: 'Telemetry', link: '/telemetry' },
          { text: 'CLI & TUI', link: '/cli-tui' },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/pankyada/base' },
    ],
  },
})
```

`base: '/base/'` required because GitHub Pages serves at `pankyada.github.io/base/` (project site, not user site).

---

## Content Outline

| Page | Key content |
|------|-------------|
| `index.md` | Hero tagline, 3-line install snippet, links to Getting Started + GitHub |
| `getting-started.md` | Install (`pnpm install`), start server (`pnpm dev`), connect via TUI / Web / REST |
| `profiles.md` | Full YAML field reference (all `ProfileSchema` fields with types + defaults), annotated `devops.yaml` as worked example |
| `builtin-tools.md` | Table: tool name, params, ACL default, one-line example — all 14 tools (Read, Write, Edit, Bash, Grep, Glob, Skill, MemoryRead/Write/Delete/List, Stats, Delegate, ExecuteCode, AskUser, TodoRead, TodoWrite) |
| `skills.md` | 4 discovery paths (user/project/sub-project/folder), `SKILL.md` frontmatter format, full example from `.agents/skills/security/vuln-patterns/` |
| `memory.md` | fs vs graph providers, 3 scopes (session/profile/user), `MemoryLinked` graph traversal, example reads/writes |
| `mcp-servers.md` | All 4 transports (stdio/streamable-http/sse/websocket) with YAML snippets, ACL wildcard + per-tool, `serverName__toolName` naming convention |
| `multi-agent.md` | `agents:` block, `Delegate` tool, `DelegateFanout`, typed I/O contracts, `max_depth`, `research.yaml` as full example |
| `hooks.md` | pre_tool / post_tool / on_stop, env vars `TOOL_NAME` + `TOOL_OK`, timeout config, `writer.yaml` on_stop as example |
| `self-improvement.md` | Post-session reflection loop, skill mining, `improvement:` config block (enabled, model_id, mine_skills_every_n_sessions) |
| `telemetry.md` | JSONL event schema (all fields), `jq` query examples for filtering + aggregating |
| `cli-tui.md` | CLI startup flags, TUI keyboard shortcuts (Ctrl+K palette, Ctrl+T timeline, Ctrl+M memory panel, etc.) |

---

## GitHub Actions Workflow

```yaml
# .github/workflows/docs.yml
name: Deploy docs
on:
  push:
    branches: [main]
    paths: ['docs-site/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter harness-docs build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs-site/.vitepress/dist
```

Only triggers when `docs-site/**` changes. Uses `contents: write` permission — no PAT required.

---

## Deliverables

- `docs-site/package.json`
- `docs-site/.vitepress/config.ts`
- `docs-site/docs/index.md` + 11 content pages
- `.github/workflows/docs.yml`
- `pnpm-workspace.yaml` updated to include `docs-site`
- `docs/ROADMAP.md` updated: #10 marked ✅
