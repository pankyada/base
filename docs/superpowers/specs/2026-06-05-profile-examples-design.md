# Profile Examples Design

**Date:** 2026-06-05  
**Status:** Approved  
**Purpose:** Demo/showcase — illustrate the breadth of the harness profile system across 4 domains

---

## Goal

Create 4 example profile YAML files that each demonstrate a distinct harness feature, paired with matching system prompts and agent skills. All profiles use Anthropic Claude models.

---

## Profiles Overview

| File | Mode | Unique harness feature | Model |
|------|------|------------------------|-------|
| `profiles/devops.yaml` | none (explicit ACLs) | Cron trigger — daily infra health check at 08:00 | `claude-sonnet-4-6` |
| `profiles/research.yaml` | none (explicit ACLs) | `agents:` block — orchestrator + researcher + summariser sub-agents | `claude-opus-4-8` |
| `profiles/writer.yaml` | none (explicit ACLs) | Typed I/O contract + `on_stop` git-stage hook | `claude-sonnet-4-6` |
| `profiles/security.yaml` | none (explicit ACLs) | Webhook trigger — fires on CI push for automated code audit | `claude-opus-4-8` |

> **Why no `mode:` field?** `applyModeDefaults` in `src/profiles/loader.ts` always overwrites profile-level `tools.builtin` entries — mode wins on conflict. `Bash` is denied by every non-developer mode (blocks devops); `Delegate` and `Write` are denied by every non-developer mode (blocks research and writer); for security, `developer`+webhook throws a hard validation error, `analyst` forces `ExecuteCode: allow`, and `production` sets `Grep`/`Skill`/`Glob` to `prompt`. Explicit ACLs give full control without these mode constraints.

Sub-agent worker profiles for research orchestration:
- `profiles/researcher.yaml` — fetch-only worker
- `profiles/summariser.yaml` — write-only worker

---

## Profile Designs

### 1. `profiles/devops.yaml`

**What it does:** Infra health-check agent. Wakes daily at 08:00 via cron, checks system state, writes a dated report to `.harness/devops/reports/`. Also usable interactively for shell tasks, Docker ops, GitHub CI queries.

**Mode:** none — explicit ACLs

**Cron trigger:**
```yaml
triggers:
  cron: "0 8 * * *"
  cron_input:
    task: "Run daily infra health check. Write report to reports/YYYY-MM-DD.md"
```

**MCP servers:**
- `@modelcontextprotocol/server-github` (stdio, env: `GITHUB_TOKEN`) — PR status, CI run checks, repo operations. ACL: `list_pull_requests: allow`, `get_pull_request: allow`, `*: prompt`
- `@modelcontextprotocol/server-filesystem` scoped to `/var/log` (stdio) — log reads without full FS access. ACL: `read_file: allow`, `*: deny`

**Skills:**
- `.agents/skills/devops/incident-runbook/SKILL.md` — structured runbook template for outages
- `.agents/skills/devops/rollback-checklist/SKILL.md` — pre-rollback verification steps

---

### 2. `profiles/research.yaml`

**What it does:** Orchestrator that fans work to two sub-agents. The `researcher` fetches and reads sources; the `summariser` synthesises findings into a structured report. Parent agent coordinates via `Delegate` and `DelegateFanout`, does not fetch directly.

**Mode:** none — explicit ACLs

**`agents:` block:**
```yaml
agents:
  - name: researcher
    profile: ./researcher.yaml
    input:
      query: { type: string }
      sources: { type: array }
    output:
      findings: { type: array }
  - name: summariser
    profile: ./summariser.yaml
    input:
      findings: { type: array }
      format: { type: string }
    output:
      report: { type: string }
```

**Worker profiles:**
- `profiles/researcher.yaml` — `assistant` mode, MCP fetch + brave-search, no Write/Edit
- `profiles/summariser.yaml` — `assistant` mode, Write allowed (artifact only), no MCP

**MCP servers (on research.yaml):**
- `@modelcontextprotocol/server-fetch` (stdio) — HTTP GET for web sources. ACL: `fetch: allow`, `*: deny`
- `@modelcontextprotocol/server-brave-search` (stdio, env: `BRAVE_API_KEY`) — web search. ACL: `brave_web_search: allow`, `*: deny`

**Skills:**
- `.agents/skills/research/extract-claims/SKILL.md` — extract factual claims + source URLs from raw fetched text

---

### 3. `profiles/writer.yaml`

**What it does:** Content-generation agent for docs, changelogs, blog posts, emails. Accepts a typed input contract. On stop, a shell hook stages drafts with `git add` so nothing is lost.

**Mode:** none — explicit ACLs

**Typed I/O contract:**
```yaml
contract:
  input:
    type: object
    required: [topic, format]
    properties:
      topic: { type: string }
      format: { enum: [blog, changelog, email, docs] }
      tone: { enum: [formal, casual, technical] }
  output:
    type: object
    properties:
      draft: { type: string }
      word_count: { type: integer }
```

**on_stop hook:**
```yaml
hooks:
  on_stop:
    - "git add .harness/writer/drafts 2>/dev/null || true"
```

**MCP servers:** none — keeps the profile minimal and purely LLM-driven.

**Skills:**
- `.agents/skills/writer/changelog-generator/SKILL.md` — turns `git log` output into a formatted CHANGELOG entry

---

### 4. `profiles/security.yaml`

**What it does:** Code-audit agent. Fires via webhook on CI push (`POST /webhooks/security`). Reads source files, runs analysis via Bash (grep-based pattern matching, language-specific linters), writes a findings report. Also works interactively for manual audits.

**Mode:** none — explicit ACLs

**Webhook trigger:**
```yaml
triggers:
  webhook: true
```

**Typed I/O contract (webhook payload):**
```yaml
contract:
  input:
    type: object
    required: [repo_path, commit_sha]
    properties:
      repo_path: { type: string }
      commit_sha: { type: string }
      languages: { type: array, items: { type: string } }
  output:
    type: object
    properties:
      findings: { type: array }
      severity_counts: { type: object }
      report_path: { type: string }
```

**MCP servers:**
- `@modelcontextprotocol/server-filesystem` scoped to repo root (stdio) — read-only code traversal. ACL: `read_file: allow`, `list_directory: allow`, `*: deny`

**Skills:**
- `.agents/skills/security/vuln-patterns/SKILL.md` — checklist of SQLi, path traversal, hardcoded secrets, unsafe deserialization patterns with grep signatures
- `.agents/skills/security/audit-report-template/SKILL.md` — structured markdown template for findings

---

## Deliverables

### Profile YAML files
- `profiles/devops.yaml`
- `profiles/research.yaml`
- `profiles/researcher.yaml` (worker)
- `profiles/summariser.yaml` (worker)
- `profiles/writer.yaml`
- `profiles/security.yaml`

### System prompts
- `prompts/devops.md`
- `prompts/research.md`
- `prompts/researcher.md`
- `prompts/summariser.md`
- `prompts/writer.md`
- `prompts/security.md`

### Agent skills
- `.agents/skills/devops/incident-runbook/SKILL.md`
- `.agents/skills/devops/rollback-checklist/SKILL.md`
- `.agents/skills/research/extract-claims/SKILL.md`
- `.agents/skills/writer/changelog-generator/SKILL.md`
- `.agents/skills/security/vuln-patterns/SKILL.md`
- `.agents/skills/security/audit-report-template/SKILL.md`

---

## Architecture notes

- All profiles use `base_url: https://api.anthropic.com/v1` with `ANTHROPIC_API_KEY`
- Worker profiles (`researcher`, `summariser`) have no triggers and tight ACLs — safe to run headless
- `security.yaml` webhook endpoint: `POST /webhooks/security` with JSON body matching the input contract
- MCP package names are npm-installable; `npx -y` handles install on first run
- Skills live at project level (`.agents/skills/`) — auto-discovered by the harness skill loader
