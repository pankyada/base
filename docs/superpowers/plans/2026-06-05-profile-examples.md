# Profile Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 4 demo profile YAMLs (devops, research, writer, security) each showcasing a distinct harness feature — cron trigger, multi-agent orchestration, typed I/O contract, and webhook trigger — paired with system prompts and agent skills.

**Architecture:** All profiles use Anthropic's OpenAI-compatible endpoint (`https://api.anthropic.com/v1`). None use the `mode:` field because mode always wins over profile-level tool overrides, and each profile needs at least one tool that every preset mode denies (Bash for devops/security, Delegate for research, Write for writer). Explicit ACLs are used throughout. Skills live under `.agents/skills/` and are auto-discovered by the harness skill loader.

**Tech Stack:** YAML (js-yaml), Vitest (tests), `loadProfile` from `src/profiles/loader.ts`, `ProfileSchema` from `src/profiles/schema.ts`, MCP servers via npx.

---

## Key constraint: why no `mode:` on any profile

`applyModeDefaults` in `src/profiles/loader.ts:16` always overwrites profile-level `tools.builtin` entries with mode defaults — mode wins on conflict. Additionally `validateMode` hard-errors if `mode: developer` is combined with any trigger. This means:

- `devops` needs `Bash: allow` + cron trigger → no mode fits (developer+cron throws; analyst/production deny Bash)
- `research` needs `Delegate: allow` → all non-developer modes deny Delegate
- `writer` needs `Write: allow` → all non-developer modes deny Write
- `security` needs `Grep: allow` + `Skill: allow` → production mode overrides both to `prompt`; analyst forces `ExecuteCode: allow`

Explicit ACLs are the right call for all four. The spec is updated in Task 1.

---

## File Map

**New files:**

| Path | Purpose |
|------|---------|
| `profiles/devops.yaml` | Devops agent — cron trigger, GitHub + log MCP |
| `profiles/research.yaml` | Research orchestrator — agents block, fetch + search MCP |
| `profiles/researcher.yaml` | Worker: fetch sources, extract findings |
| `profiles/summariser.yaml` | Worker: synthesise findings into report |
| `profiles/writer.yaml` | Writer agent — typed I/O contract, on_stop git hook |
| `profiles/security.yaml` | Security audit — webhook trigger, filesystem MCP |
| `prompts/devops.md` | System prompt for devops agent |
| `prompts/research.md` | System prompt for research orchestrator |
| `prompts/researcher.md` | System prompt for researcher worker |
| `prompts/summariser.md` | System prompt for summariser worker |
| `prompts/writer.md` | System prompt for writer agent |
| `prompts/security.md` | System prompt for security agent |
| `.agents/skills/devops/incident-runbook/SKILL.md` | Incident response runbook template |
| `.agents/skills/devops/rollback-checklist/SKILL.md` | Pre-rollback verification checklist |
| `.agents/skills/research/extract-claims/SKILL.md` | Structured findings extraction format |
| `.agents/skills/writer/changelog-generator/SKILL.md` | git-log → CHANGELOG workflow |
| `.agents/skills/security/vuln-patterns/SKILL.md` | Grep signatures for common vuln patterns |
| `.agents/skills/security/audit-report-template/SKILL.md` | Findings report Markdown template |
| `tests/example-profiles.test.ts` | Integration tests — load each profile and validate fields |

**Modified files:**

| Path | Change |
|------|--------|
| `docs/superpowers/specs/2026-06-05-profile-examples-design.md` | Correct mode assignments; explain why no mode is used |

---

## Task 1: Update design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-profile-examples-design.md`

- [ ] **Step 1: Edit Section 1 — Profile overview table**

Open `docs/superpowers/specs/2026-06-05-profile-examples-design.md`. Replace the table in "Section 1 — Profile overview" with:

```markdown
| File | Mode | Unique harness feature | Model |
|------|------|------------------------|-------|
| `profiles/devops.yaml` | none (explicit ACLs) | Cron trigger — daily infra health check at 08:00 | `claude-sonnet-4-6` |
| `profiles/research.yaml` | none (explicit ACLs) | `agents:` block — orchestrator + researcher + summariser sub-agents | `claude-opus-4-8` |
| `profiles/writer.yaml` | none (explicit ACLs) | Typed I/O contract + `on_stop` git-stage hook | `claude-sonnet-4-6` |
| `profiles/security.yaml` | none (explicit ACLs) | Webhook trigger — fires on CI push for automated code audit | `claude-opus-4-8` |
```

- [ ] **Step 2: Add constraint note after the table**

Insert this paragraph after the table:

```markdown
> **Why no `mode:` field?** `applyModeDefaults` in `src/profiles/loader.ts` always overwrites profile-level `tools.builtin` entries — mode wins on conflict. Each profile needs at least one tool every preset mode denies (`Bash` for devops, `Delegate` for research, `Write` for writer, `Grep`+`Skill` for security). Explicit ACLs give full control without mode interference.
```

- [ ] **Step 3: Fix per-profile mode references**

In each profile's design section, replace `**Mode:** developer` / `**Mode:** analyst` / `**Mode:** assistant` with `**Mode:** none — explicit ACLs` and remove the `Delegate: allow` / `Write: allow` "override" notes (they're now just normal ACL entries).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-05-profile-examples-design.md
git commit -m "docs: correct mode assignments in profile examples spec — explicit ACLs throughout"
```

---

## Task 2: Write failing tests

**Files:**
- Create: `tests/example-profiles.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { loadProfile } from '../src/profiles/loader.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

describe('devops profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/devops.yaml')) })

  it('name is devops', () => { expect(profile.name).toBe('devops') })
  it('model id is claude-sonnet-4-6', () => { expect(profile.model.id).toBe('claude-sonnet-4-6') })
  it('api_key_env is ANTHROPIC_API_KEY', () => { expect(profile.model.api_key_env).toBe('ANTHROPIC_API_KEY') })
  it('Bash is allow', () => { expect(profile.tools.builtin.Bash).toBe('allow') })
  it('ExecuteCode is deny', () => { expect(profile.tools.builtin.ExecuteCode).toBe('deny') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('cron trigger fires at 08:00 daily', () => { expect(profile.triggers?.cron).toBe('0 8 * * *') })
  it('cron_input has a task string', () => {
    expect(typeof (profile.triggers?.cron_input as any)?.task).toBe('string')
  })
  it('has 2 MCP servers named github and logs', () => {
    const names = profile.tools.mcp_servers.map(s => s.name)
    expect(names).toContain('github')
    expect(names).toContain('logs')
  })
})

describe('research profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/research.yaml')) })

  it('name is research', () => { expect(profile.name).toBe('research') })
  it('model id is claude-opus-4-8', () => { expect(profile.model.id).toBe('claude-opus-4-8') })
  it('Delegate is allow', () => { expect(profile.tools.builtin.Delegate).toBe('allow') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Write is deny', () => { expect(profile.tools.builtin.Write).toBe('deny') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('has 2 sub-agents named researcher and summariser', () => {
    const names = (profile.agents ?? []).map(a => a.name)
    expect(names).toContain('researcher')
    expect(names).toContain('summariser')
  })
  it('researcher agent input requires query field', () => {
    const agent = (profile.agents ?? []).find(a => a.name === 'researcher')!
    expect((agent.input as any).required).toContain('query')
  })
  it('summariser agent input requires findings field', () => {
    const agent = (profile.agents ?? []).find(a => a.name === 'summariser')!
    expect((agent.input as any).required).toContain('findings')
  })
  it('has 2 MCP servers named fetch and brave-search', () => {
    const names = profile.tools.mcp_servers.map(s => s.name)
    expect(names).toContain('fetch')
    expect(names).toContain('brave-search')
  })
})

describe('researcher worker profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/researcher.yaml')) })

  it('name is researcher', () => { expect(profile.name).toBe('researcher') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Write is deny', () => { expect(profile.tools.builtin.Write).toBe('deny') })
  it('Edit is deny', () => { expect(profile.tools.builtin.Edit).toBe('deny') })
  it('Delegate is deny', () => { expect(profile.tools.builtin.Delegate).toBe('deny') })
  it('Read is allow', () => { expect(profile.tools.builtin.Read).toBe('allow') })
  it('improvement is disabled', () => { expect(profile.improvement.enabled).toBe(false) })
})

describe('summariser worker profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/summariser.yaml')) })

  it('name is summariser', () => { expect(profile.name).toBe('summariser') })
  it('Write is allow', () => { expect(profile.tools.builtin.Write).toBe('allow') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Delegate is deny', () => { expect(profile.tools.builtin.Delegate).toBe('deny') })
  it('no MCP servers', () => { expect(profile.tools.mcp_servers).toHaveLength(0) })
  it('improvement is disabled', () => { expect(profile.improvement.enabled).toBe(false) })
})

describe('writer profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/writer.yaml')) })

  it('name is writer', () => { expect(profile.name).toBe('writer') })
  it('model id is claude-sonnet-4-6', () => { expect(profile.model.id).toBe('claude-sonnet-4-6') })
  it('Write is allow', () => { expect(profile.tools.builtin.Write).toBe('allow') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Edit is deny', () => { expect(profile.tools.builtin.Edit).toBe('deny') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('no MCP servers', () => { expect(profile.tools.mcp_servers).toHaveLength(0) })
  it('contract input requires topic and format', () => {
    const input = profile.contract?.input as any
    expect(input?.required).toContain('topic')
    expect(input?.required).toContain('format')
  })
  it('contract input format enum contains blog changelog email docs', () => {
    const input = profile.contract?.input as any
    expect(input?.properties?.format?.enum).toEqual(['blog', 'changelog', 'email', 'docs'])
  })
  it('on_stop hook stages drafts with git add', () => {
    expect(profile.hooks.on_stop).toHaveLength(1)
    expect(profile.hooks.on_stop[0]).toContain('git add')
    expect(profile.hooks.on_stop[0]).toContain('.harness/writer/drafts')
  })
})

describe('security profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/security.yaml')) })

  it('name is security', () => { expect(profile.name).toBe('security') })
  it('model id is claude-opus-4-8', () => { expect(profile.model.id).toBe('claude-opus-4-8') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Write is deny', () => { expect(profile.tools.builtin.Write).toBe('deny') })
  it('Edit is deny', () => { expect(profile.tools.builtin.Edit).toBe('deny') })
  it('ExecuteCode is deny', () => { expect(profile.tools.builtin.ExecuteCode).toBe('deny') })
  it('Grep is allow', () => { expect(profile.tools.builtin.Grep).toBe('allow') })
  it('Skill is allow', () => { expect(profile.tools.builtin.Skill).toBe('allow') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('webhook trigger is enabled', () => { expect(profile.triggers?.webhook).toBe(true) })
  it('contract input requires repo_path and commit_sha', () => {
    const input = profile.contract?.input as any
    expect(input?.required).toContain('repo_path')
    expect(input?.required).toContain('commit_sha')
  })
  it('has 1 MCP server named codebase', () => {
    expect(profile.tools.mcp_servers).toHaveLength(1)
    expect(profile.tools.mcp_servers[0].name).toBe('codebase')
  })
})

describe('skill files exist with valid frontmatter', () => {
  const skills = [
    '.agents/skills/devops/incident-runbook/SKILL.md',
    '.agents/skills/devops/rollback-checklist/SKILL.md',
    '.agents/skills/research/extract-claims/SKILL.md',
    '.agents/skills/writer/changelog-generator/SKILL.md',
    '.agents/skills/security/vuln-patterns/SKILL.md',
    '.agents/skills/security/audit-report-template/SKILL.md',
  ]

  for (const rel of skills) {
    it(`${rel} exists and has name + description frontmatter`, () => {
      const full = resolve(ROOT, rel)
      expect(existsSync(full), `missing: ${full}`).toBe(true)
      const content = readFileSync(full, 'utf-8')
      expect(content).toMatch(/^---/)
      expect(content).toMatch(/name:/)
      expect(content).toMatch(/description:/)
    })
  }
})
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npx vitest run tests/example-profiles.test.ts 2>&1 | tail -20
```

Expected: all `describe` blocks fail with `ENOENT` or similar because no profile files exist yet.

---

## Task 3: Create `devops` profile + prompt

**Files:**
- Create: `profiles/devops.yaml`
- Create: `prompts/devops.md`

- [ ] **Step 1: Create `profiles/devops.yaml`**

```yaml
name: devops
description: "Infra health-check and DevOps automation agent. Runs daily at 08:00 via cron; usable interactively too."
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6
  fallback_id: claude-sonnet-4-6
system_prompt: ./prompts/devops.md
working_dir: $CWD
artifact_dir: .harness/devops
tools:
  builtin:
    Read: allow
    Write: allow
    Edit: allow
    Bash: allow
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    MemoryDelete: allow
    Stats: allow
    Delegate: allow
    AskUser: allow
    TodoWrite: allow
    TodoRead: allow
    ExecuteCode: deny
  mcp_servers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
      acl:
        list_pull_requests: allow
        get_pull_request: allow
        list_commits: allow
        get_file_contents: allow
        "*": prompt
    - name: logs
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/var/log"]
      acl:
        read_file: allow
        list_directory: allow
        "*": deny
triggers:
  cron: "0 8 * * *"
  cron_input:
    task: "Run daily infra health check. Check disk usage (df -h), top 5 memory consumers (ps aux --sort=-%mem | head -6), and open GitHub PRs. Write a dated Markdown report to reports/."
hooks:
  pre_tool: []
  post_tool: []
  on_stop: []
improvement:
  enabled: true
  mine_skills_every_n_sessions: 10
```

- [ ] **Step 2: Create `prompts/devops.md`**

```markdown
# DevOps Agent

You are an infrastructure automation and health-check agent.

## Cron mode
When invoked via cron trigger, your input contains a `task` string. Execute it:
1. Run `df -h` to check disk usage.
2. Run `ps aux --sort=-%mem | head -6` to check top memory processes.
3. Use the `github` MCP to list open PRs and any failed CI runs.
4. Read recent errors from `/var/log` via the `logs` MCP.
5. Write a Markdown report to `reports/YYYY-MM-DD.md` in the artifact directory.

## Interactive mode
Help with shell tasks, Docker operations, GitHub queries, and log investigation. Use `Bash` for system checks, `github` MCP for GitHub API, `logs` MCP for `/var/log` reads (scoped — no direct shell access to log files needed).

## Memory
Write to `MemoryWrite`: recurring incidents, known quirks, team conventions, deploy schedules.

## Skills
Check `incident-runbook` when responding to incidents. Check `rollback-checklist` before any rollback.
```

- [ ] **Step 3: Run devops tests only**

```bash
npx vitest run tests/example-profiles.test.ts -t "devops" 2>&1 | tail -15
```

Expected: all `devops profile` tests pass.

- [ ] **Step 4: Commit**

```bash
git add profiles/devops.yaml prompts/devops.md
git commit -m "feat: add devops profile with cron trigger and GitHub/log MCP servers"
```

---

## Task 4: Create `researcher` + `summariser` worker profiles + prompts

**Files:**
- Create: `profiles/researcher.yaml`
- Create: `profiles/summariser.yaml`
- Create: `prompts/researcher.md`
- Create: `prompts/summariser.md`

- [ ] **Step 1: Create `profiles/researcher.yaml`**

```yaml
name: researcher
description: "Fetch-only research worker. Retrieves web sources and extracts structured findings. Called by the research orchestrator."
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6
system_prompt: ./prompts/researcher.md
working_dir: $CWD
artifact_dir: .harness/researcher
tools:
  builtin:
    Read: allow
    Write: deny
    Edit: deny
    Bash: deny
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    MemoryDelete: deny
    Stats: allow
    Delegate: deny
    AskUser: deny
    TodoWrite: deny
    TodoRead: deny
    ExecuteCode: deny
  mcp_servers:
    - name: fetch
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-fetch"]
      acl:
        fetch: allow
        "*": deny
    - name: brave-search
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-brave-search"]
      env:
        BRAVE_API_KEY: "${BRAVE_API_KEY}"
      acl:
        brave_web_search: allow
        "*": deny
improvement:
  enabled: false
  mine_skills_every_n_sessions: 10
```

- [ ] **Step 2: Create `profiles/summariser.yaml`**

```yaml
name: summariser
description: "Synthesis worker. Takes research findings and writes a structured report. Called by the research orchestrator."
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6
system_prompt: ./prompts/summariser.md
working_dir: $CWD
artifact_dir: .harness/summariser
tools:
  builtin:
    Read: allow
    Write: allow
    Edit: deny
    Bash: deny
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: deny
    MemoryList: allow
    MemoryDelete: deny
    Stats: allow
    Delegate: deny
    AskUser: deny
    TodoWrite: deny
    TodoRead: deny
    ExecuteCode: deny
  mcp_servers: []
improvement:
  enabled: false
  mine_skills_every_n_sessions: 10
```

- [ ] **Step 3: Create `prompts/researcher.md`**

```markdown
# Researcher Worker

You fetch web sources and extract structured findings. You are called by the research orchestrator — do not interact with users directly.

## Inputs
- `query`: the research question to investigate
- `sources`: optional list of specific URLs to fetch directly

## Process
1. If `sources` is empty, call `brave-search` MCP (`brave_web_search`) with the query to get relevant URLs.
2. For each URL, call `fetch` MCP to retrieve page content.
3. Extract factual claims. Each claim must have: a source URL, a direct quote, and a confidence level (high/medium/low).
4. Return: `{ findings: [{ claim, source, quote, confidence }] }`.

## Constraints
- Do not write files.
- Do not call sub-agents.
- Do not ask the user questions.
- Return findings only. The orchestrator handles synthesis.
```

- [ ] **Step 4: Create `prompts/summariser.md`**

```markdown
# Summariser Worker

You synthesise research findings into a structured report. You are called by the research orchestrator — do not interact with users directly.

## Inputs
- `findings`: array of `{ claim, source, quote, confidence }` objects from the researcher
- `format`: one of `markdown`, `html`, or `plain`

## Process
1. Group findings by theme or topic.
2. Write a structured report in the requested format with inline source citations.
3. Write the report to `reports/<slug>.md` in the artifact directory (slug = first 5 words of the first finding, kebab-cased).
4. Return: `{ report: "<full report content>" }`.

## Constraints
- Do not fetch URLs.
- Do not call sub-agents.
- Write only to the `reports/` subdirectory of the artifact dir.
```

- [ ] **Step 5: Run worker tests**

```bash
npx vitest run tests/example-profiles.test.ts -t "researcher worker|summariser worker" 2>&1 | tail -15
```

Expected: all `researcher worker profile` and `summariser worker profile` tests pass.

- [ ] **Step 6: Commit**

```bash
git add profiles/researcher.yaml profiles/summariser.yaml prompts/researcher.md prompts/summariser.md
git commit -m "feat: add researcher and summariser worker profiles"
```

---

## Task 5: Create `research` orchestrator profile + prompt

**Files:**
- Create: `profiles/research.yaml`
- Create: `prompts/research.md`

- [ ] **Step 1: Create `profiles/research.yaml`**

```yaml
name: research
description: "Research orchestrator. Fans work out to researcher and summariser sub-agents; synthesises findings into a structured report."
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-opus-4-8
system_prompt: ./prompts/research.md
working_dir: $CWD
artifact_dir: .harness/research
tools:
  builtin:
    Read: allow
    Write: deny
    Edit: deny
    Bash: deny
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    MemoryDelete: allow
    Stats: allow
    Delegate: allow
    AskUser: allow
    TodoWrite: allow
    TodoRead: allow
    ExecuteCode: deny
  mcp_servers:
    - name: fetch
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-fetch"]
      acl:
        fetch: allow
        "*": deny
    - name: brave-search
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-brave-search"]
      env:
        BRAVE_API_KEY: "${BRAVE_API_KEY}"
      acl:
        brave_web_search: allow
        "*": deny
agents:
  - name: researcher
    profile: ./researcher.yaml
    input:
      type: object
      required:
        - query
      properties:
        query:
          type: string
        sources:
          type: array
          items:
            type: string
    output:
      type: object
      required:
        - findings
      properties:
        findings:
          type: array
          items:
            type: object
  - name: summariser
    profile: ./summariser.yaml
    input:
      type: object
      required:
        - findings
      properties:
        findings:
          type: array
        format:
          type: string
          enum:
            - markdown
            - html
            - plain
    output:
      type: object
      required:
        - report
      properties:
        report:
          type: string
improvement:
  enabled: true
  mine_skills_every_n_sessions: 10
```

- [ ] **Step 2: Create `prompts/research.md`**

```markdown
# Research Orchestrator

You coordinate research by delegating to two specialist sub-agents. You do not fetch sources yourself.

## Sub-agents
- **researcher** — fetches web sources, extracts findings with citations
- **summariser** — takes findings and writes a structured report

## Workflow
1. Clarify the research question with the user if it is ambiguous (use `AskUser`).
2. Call `Delegate` with target `researcher` and input `{ query: "<the question>", sources: [] }`.
3. Receive `{ findings: [...] }` back from the researcher.
4. Call `Delegate` with target `summariser` and input `{ findings: <from step 3>, format: "markdown" }`.
5. Return the summariser's `report` to the user. Mention the artifact path where it was saved.

## Memory
Use `MemoryWrite` to track research topics already covered, source quality observations, and format preferences.

## Skills
Use `extract-claims` to validate that the researcher's findings are properly structured (each item has claim, source, quote, confidence) before passing to the summariser.
```

- [ ] **Step 3: Run research tests**

```bash
npx vitest run tests/example-profiles.test.ts -t "^research profile" 2>&1 | tail -15
```

Expected: all `research profile` tests pass.

- [ ] **Step 4: Commit**

```bash
git add profiles/research.yaml prompts/research.md
git commit -m "feat: add research orchestrator profile with agents block and fetch/search MCP"
```

---

## Task 6: Create `writer` profile + prompt

**Files:**
- Create: `profiles/writer.yaml`
- Create: `prompts/writer.md`

- [ ] **Step 1: Create `profiles/writer.yaml`**

```yaml
name: writer
description: "Content-generation agent for blog posts, changelogs, email drafts, and docs. Accepts typed input; drafts are staged with git on stop."
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6
system_prompt: ./prompts/writer.md
working_dir: $CWD
artifact_dir: .harness/writer
tools:
  builtin:
    Read: allow
    Write: allow
    Edit: deny
    Bash: deny
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    MemoryDelete: allow
    Stats: allow
    Delegate: deny
    AskUser: allow
    TodoWrite: allow
    TodoRead: allow
    ExecuteCode: deny
  mcp_servers: []
contract:
  input:
    type: object
    required:
      - topic
      - format
    properties:
      topic:
        type: string
        description: "What to write about"
      format:
        type: string
        enum:
          - blog
          - changelog
          - email
          - docs
      tone:
        type: string
        enum:
          - formal
          - casual
          - technical
        default: formal
  output:
    type: object
    properties:
      draft:
        type: string
      word_count:
        type: integer
hooks:
  pre_tool: []
  post_tool: []
  on_stop:
    - "git add .harness/writer/drafts 2>/dev/null || true"
improvement:
  enabled: true
  mine_skills_every_n_sessions: 10
```

- [ ] **Step 2: Create `prompts/writer.md`**

```markdown
# Writer Agent

You write structured content: blog posts, changelogs, email drafts, and documentation.

## Inputs (via REST contract or chat)
- `topic` (required): what to write about
- `format` (required): one of `blog`, `changelog`, `email`, `docs`
- `tone` (optional, default `formal`): one of `formal`, `casual`, `technical`

## Process
1. If `topic` is vague (e.g. "write something about auth"), use `AskUser` to clarify scope, audience, and length.
2. If `format` is `changelog`, invoke the `changelog-generator` skill before writing.
3. Write the draft to `.harness/writer/drafts/<slug>.md` where slug is a 3–5 word kebab-case summary of the topic.
4. Count words in the draft.
5. Return `{ draft: "<content>", word_count: <n> }`.

## Constraints
- Write only to `.harness/writer/drafts/`. No other paths.
- No shell, no external fetches, no code execution.
- `Edit` is disabled — use `Write` to create new drafts; never overwrite existing ones without asking.

## Memory
Use `MemoryWrite` to track: recurring topics, tone preferences, client voice guidelines.
```

- [ ] **Step 3: Run writer tests**

```bash
npx vitest run tests/example-profiles.test.ts -t "writer profile" 2>&1 | tail -15
```

Expected: all `writer profile` tests pass.

- [ ] **Step 4: Commit**

```bash
git add profiles/writer.yaml prompts/writer.md
git commit -m "feat: add writer profile with typed I/O contract and on_stop git-stage hook"
```

---

## Task 7: Create `security` profile + prompt

**Files:**
- Create: `profiles/security.yaml`
- Create: `prompts/security.md`

- [ ] **Step 1: Create `profiles/security.yaml`**

```yaml
name: security
description: "Read-only code-audit agent. Fires on CI push via webhook; inspects source files for vulnerability patterns and writes a findings report."
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-opus-4-8
system_prompt: ./prompts/security.md
working_dir: $CWD
artifact_dir: .harness/security
tools:
  builtin:
    Read: allow
    Write: deny
    Edit: deny
    Bash: deny
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    MemoryDelete: allow
    Stats: allow
    Delegate: deny
    AskUser: deny
    TodoWrite: allow
    TodoRead: allow
    ExecuteCode: deny
  mcp_servers:
    - name: codebase
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "$CWD"]
      acl:
        read_file: allow
        list_directory: allow
        "*": deny
triggers:
  webhook: true
contract:
  input:
    type: object
    required:
      - repo_path
      - commit_sha
    properties:
      repo_path:
        type: string
        description: "Absolute path to the repository root"
      commit_sha:
        type: string
        description: "The commit SHA to audit"
      languages:
        type: array
        items:
          type: string
        description: "Languages present in the repo e.g. ['typescript', 'python']"
  output:
    type: object
    properties:
      findings:
        type: array
        items:
          type: object
      severity_counts:
        type: object
      report_path:
        type: string
improvement:
  enabled: true
  mine_skills_every_n_sessions: 10
```

- [ ] **Step 2: Create `prompts/security.md`**

```markdown
# Security Audit Agent

You perform static code audits. You are triggered by CI webhooks. You are read-only — you never modify source files.

## Inputs (via webhook contract)
- `repo_path`: absolute path to the repository root
- `commit_sha`: the commit to audit
- `languages`: array of languages present (e.g. `["typescript", "python"]`)

## Process
1. Use the `codebase` MCP (`list_directory`) to map the repository structure starting from `repo_path`.
2. Use the `vuln-patterns` skill to get the grep signatures for each pattern.
3. Use `Grep` to search for each pattern across source files. Focus on files in `src/`, `lib/`, `app/` directories.
4. For each match, read the surrounding context (±10 lines) via the `codebase` MCP (`read_file`).
5. Classify each finding: `critical` / `high` / `medium` / `low` per the severity guide in `vuln-patterns`.
6. Write the report to `.harness/security/reports/<commit_sha>.md` using the `audit-report-template` skill.
7. Return `{ findings: [...], severity_counts: { critical: N, high: N, medium: N, low: N }, report_path: ".harness/security/reports/<commit_sha>.md" }`.

## Constraints
- Read files only. Never write to source directories.
- Write only to `.harness/security/reports/`.
- Do not ask the user questions (webhook mode — no interactive user).
- Do not execute code.
```

- [ ] **Step 3: Run security tests**

```bash
npx vitest run tests/example-profiles.test.ts -t "security profile" 2>&1 | tail -15
```

Expected: all `security profile` tests pass.

- [ ] **Step 4: Commit**

```bash
git add profiles/security.yaml prompts/security.md
git commit -m "feat: add security audit profile with webhook trigger and typed I/O contract"
```

---

## Task 8: Create devops skills

**Files:**
- Create: `.agents/skills/devops/incident-runbook/SKILL.md`
- Create: `.agents/skills/devops/rollback-checklist/SKILL.md`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p .agents/skills/devops/incident-runbook
mkdir -p .agents/skills/devops/rollback-checklist
```

- [ ] **Step 2: Create `.agents/skills/devops/incident-runbook/SKILL.md`**

````markdown
---
name: incident-runbook
description: Structured runbook for responding to production incidents. Covers triage, mitigation, communication, and post-mortem steps.
---

# Incident Runbook

Use this skill when responding to a production incident. Complete each section before moving to the next.

## 1. Triage (< 5 min)

- **Severity:** [ ] P1 – service down  [ ] P2 – degraded  [ ] P3 – minor
- **Affected:** ___________ (service / endpoint / region)
- **First seen:** ___________
- **Reported by:** ___________

## 2. Immediate checks

```bash
# Disk
df -h

# Memory (top 10 consumers)
ps aux --sort=-%mem | head -11

# Recent errors (adjust path as needed)
tail -n 100 /var/log/syslog | grep -i error
```

## 3. Mitigation options (pick one)

- [ ] **Rollback deploy** → use the `rollback-checklist` skill before proceeding
- [ ] **Scale up replicas** → document current count first
- [ ] **Redirect traffic** → confirm health of target before switching
- [ ] **Disable feature flag** → note flag name and current state

## 4. Communication

- Post to `#incidents` within 5 min of P1/P2 declaration
- Update status page within 10 min
- Template: `[P1] <service> degraded since <time>. Investigating. Next update in 15 min.`

## 5. Post-mortem (within 48 h)

| Field | Notes |
|-------|-------|
| Root cause | |
| Detection time | |
| Mitigation time | |
| Fix | |
| Prevention | |
````

- [ ] **Step 3: Create `.agents/skills/devops/rollback-checklist/SKILL.md`**

````markdown
---
name: rollback-checklist
description: Pre-rollback verification checklist. Complete before reverting any deploy to avoid compounding the incident.
---

# Rollback Checklist

Complete every item before initiating rollback.

## Before rolling back

- [ ] Record current deploy version: `git log --oneline -1`
- [ ] Confirm target rollback version is healthy in staging
- [ ] Check that rollback will not drop DB migrations: `git diff <target>..<current> -- migrations/`
- [ ] Confirm who owns this rollback (name + contact)
- [ ] Update status page: "Rollback in progress" (do this BEFORE the rollback, not after)

## During rollback

- [ ] Note exact rollback command used (for the post-mortem)
- [ ] Watch error rate for 2 min after rollback completes
- [ ] Watch p99 latency for 2 min after rollback completes

## After rollback

- [ ] Confirm health check is green
- [ ] Update incident thread: "Rollback complete. Service restored at <time>."
- [ ] Lock or revert the broken branch if needed
- [ ] Schedule post-mortem meeting
````

- [ ] **Step 4: Run skill tests**

```bash
npx vitest run tests/example-profiles.test.ts -t "devops.*SKILL|incident-runbook|rollback-checklist" 2>&1 | tail -15
```

Expected: skill file tests for `incident-runbook` and `rollback-checklist` pass.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/devops/
git commit -m "feat: add devops skills — incident-runbook and rollback-checklist"
```

---

## Task 9: Create research skill

**Files:**
- Create: `.agents/skills/research/extract-claims/SKILL.md`

- [ ] **Step 1: Create directory**

```bash
mkdir -p .agents/skills/research/extract-claims
```

- [ ] **Step 2: Create `.agents/skills/research/extract-claims/SKILL.md`**

````markdown
---
name: extract-claims
description: Validate and structure factual claims extracted from web sources. Each claim must have a source URL, a direct quote, and a confidence score.
---

# Extract Claims

Use this skill to validate that the researcher's findings are correctly structured before passing them to the summariser.

## Required shape for each finding

```json
{
  "claim": "A specific, falsifiable statement in one sentence",
  "source": "https://full-url-of-the-source-page",
  "quote": "The exact sentence(s) from the source that support this claim",
  "confidence": "high | medium | low"
}
```

## Confidence levels

| Level | When to use |
|-------|-------------|
| `high` | Claim is stated explicitly and verbatim in the source |
| `medium` | Claim is a close paraphrase or summarisation of source text |
| `low` | Claim is inferred from context; must be flagged to the orchestrator |

## Validation rules

1. **One claim per object.** Split compound claims (e.g. "X is Y and also Z") into separate entries.
2. **Source must be a URL.** Discard claims with no traceable URL.
3. **Quote must be non-empty.** A missing quote means the claim is unverified — mark `confidence: low` or discard.
4. **No hallucinated sources.** If you cannot locate a quote in the fetched content, drop the claim entirely.

## Rejection template

If findings are malformed, return this to the orchestrator:

```
FINDINGS INVALID: <reason>
Expected format: [{ claim, source, quote, confidence }]
Problematic entries: <list>
```
````

- [ ] **Step 3: Run skill test**

```bash
npx vitest run tests/example-profiles.test.ts -t "extract-claims" 2>&1 | tail -10
```

Expected: `extract-claims` skill file test passes.

- [ ] **Step 4: Commit**

```bash
git add .agents/skills/research/
git commit -m "feat: add research skill — extract-claims"
```

---

## Task 10: Create writer skill

**Files:**
- Create: `.agents/skills/writer/changelog-generator/SKILL.md`

- [ ] **Step 1: Create directory**

```bash
mkdir -p .agents/skills/writer/changelog-generator
```

- [ ] **Step 2: Create `.agents/skills/writer/changelog-generator/SKILL.md`**

````markdown
---
name: changelog-generator
description: Turn git log output into a formatted CHANGELOG entry following Keep a Changelog conventions (Added / Fixed / Changed / Removed / Security).
---

# Changelog Generator

Use this skill when `format: changelog` appears in the writer input.

## Setup

Ask the user (or check the input) for:
1. **Version number** — e.g. `1.4.2`
2. **Release date** — e.g. `2026-06-05`
3. **Git log range** — e.g. `v1.4.1..HEAD` (or run `git log --oneline <prev-tag>..HEAD` via Bash if available)

## Commit → category mapping

| Commit prefix | CHANGELOG section |
|---------------|-------------------|
| `feat:` / `add:` | **Added** |
| `fix:` | **Fixed** |
| `refactor:` / `chore:` / `update:` | **Changed** |
| `remove:` / `drop:` / `revert:` | **Removed** |
| `security:` / `vuln:` | **Security** |
| `docs:` | **Changed** (unless it adds new docs → **Added**) |

## Output template

```markdown
## [X.Y.Z] – YYYY-MM-DD

### Added
- Description of new feature (#PR or commit hash)

### Fixed
- Description of bug fix (#PR or commit hash)

### Changed
- Description of change (#PR or commit hash)

### Removed
- Description of removed feature (#PR or commit hash)

### Security
- Description of security fix (no PR link — security advisories are separate)
```

## Rules

- Omit empty sections entirely.
- Group closely related commits into a single entry (e.g. 3 commits fixing the same bug = 1 entry).
- Write in past tense, imperative: "Added X", "Fixed Y", "Removed Z".
- Link to PR or commit hash in parentheses. If neither is available, omit the link.
- Do not include `chore: bump version` or similar housekeeping entries.
````

- [ ] **Step 3: Run skill test**

```bash
npx vitest run tests/example-profiles.test.ts -t "changelog-generator" 2>&1 | tail -10
```

Expected: `changelog-generator` skill file test passes.

- [ ] **Step 4: Commit**

```bash
git add .agents/skills/writer/
git commit -m "feat: add writer skill — changelog-generator"
```

---

## Task 11: Create security skills

**Files:**
- Create: `.agents/skills/security/vuln-patterns/SKILL.md`
- Create: `.agents/skills/security/audit-report-template/SKILL.md`

- [ ] **Step 1: Create directories**

```bash
mkdir -p .agents/skills/security/vuln-patterns
mkdir -p .agents/skills/security/audit-report-template
```

- [ ] **Step 2: Create `.agents/skills/security/vuln-patterns/SKILL.md`**

````markdown
---
name: vuln-patterns
description: Grep signatures for common vulnerability patterns — SQL injection, path traversal, hardcoded secrets, unsafe deserialization, open redirects. Use with the Grep tool during code audits.
---

# Vulnerability Patterns

Use these patterns with the `Grep` tool or `codebase` MCP (`read_file` + manual scan).

## 1. SQL Injection (default severity: critical)

```
grep -rn "execute\|\.query(\|\.raw(" --include="*.ts" --include="*.js" --include="*.py" <path>
```

**Signs:** User input concatenated into SQL — `"SELECT … " + req.body.id`, `` `SELECT … ${userInput}` ``, `f"SELECT … {user}"`.  
**Safe patterns:** parameterised queries — `db.query('SELECT … WHERE id=$1', [id])`, `cursor.execute("… %s", (val,))`.

## 2. Path Traversal (default severity: high)

```
grep -rn "readFile\|open(\|\.join(" --include="*.ts" --include="*.js" --include="*.py" <path>
```

**Signs:** Unsanitised user input in file path argument — look for missing `path.resolve` / `os.path.abspath`, or `../` not stripped.

## 3. Hardcoded Secrets (default severity: high)

```
grep -rni "password\s*=\s*['\"].\|secret\s*=\s*['\"].\|api_key\s*=\s*['\"].\|token\s*=\s*['\"]." --include="*.ts" --include="*.js" --include="*.py" --include="*.yaml" <path>
```

**Signs:** String literal value rather than `process.env.X` or `os.environ["X"]`.

## 4. Unsafe Deserialization (default severity: high)

```
# JS/TS
grep -rn "eval(\|new Function(\|vm\.runInNewContext\|\.unserialize(" --include="*.ts" --include="*.js" <path>

# Python
grep -rn "pickle\.loads\|yaml\.load(" --include="*.py" <path>
```

**Signs for Python:** `yaml.load(data)` without `Loader=yaml.SafeLoader` is unsafe.

## 5. Open Redirect (default severity: medium)

```
grep -rn "res\.redirect\|location\.href\s*=\|window\.location\s*=" --include="*.ts" --include="*.js" <path>
```

**Signs:** Redirect target contains unsanitised user input from query params or request body.

## Severity guide

| Pattern | Default severity |
|---------|-----------------|
| SQL Injection | critical |
| Path Traversal | high |
| Hardcoded Secret | high |
| Unsafe Deserialization | high |
| Open Redirect | medium |

Downgrade to `low` if the code path is unreachable in production. Upgrade to `critical` if the endpoint is publicly exposed and unauthenticated.
````

- [ ] **Step 3: Create `.agents/skills/security/audit-report-template/SKILL.md`**

````markdown
---
name: audit-report-template
description: Markdown template for security audit finding reports. Write one file per commit SHA to .harness/security/reports/.
---

# Audit Report Template

Write findings to `.harness/security/reports/<commit_sha>.md`.

## Template

```markdown
# Security Audit Report

**Repo:** <repo_path>  
**Commit:** `<commit_sha>`  
**Date:** <YYYY-MM-DD>  
**Auditor:** security agent (claude-opus-4-8)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | N |
| High     | N |
| Medium   | N |
| Low      | N |

---

## Findings

### [SEV-001] <Short title>

**Severity:** Critical / High / Medium / Low  
**File:** `path/to/file.ts:42`  
**Pattern:** SQL Injection / Path Traversal / Hardcoded Secret / Unsafe Deserialization / Open Redirect

**Description:**  
One paragraph explaining what the issue is and why it is dangerous in this specific context.

**Evidence:**
```
exact code snippet from the file
```

**Recommendation:**  
A specific, actionable fix (e.g. "Replace string concatenation with `db.query($1, [id])` parameterised query.").

---

<!-- Repeat for each finding, numbered SEV-002, SEV-003, etc. -->

## Files Audited

- `src/...`
- `lib/...`

## Patterns Checked

- [ ] SQL Injection
- [ ] Path Traversal
- [ ] Hardcoded Secrets
- [ ] Unsafe Deserialization
- [ ] Open Redirects
```

## Rules

- One `###` section per finding. Never bundle two findings.
- File path must include the line number (`:42`).
- Evidence must be an exact quote from the file — never paraphrased.
- Recommendation must be specific and include corrected code or a command.
- If no findings for a pattern, mark it checked (✓) in the "Patterns Checked" section but do not create a finding entry.
````

- [ ] **Step 4: Run all skill tests**

```bash
npx vitest run tests/example-profiles.test.ts -t "skill files" 2>&1 | tail -15
```

Expected: all 6 skill file tests pass.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/security/
git commit -m "feat: add security skills — vuln-patterns and audit-report-template"
```

---

## Task 12: Final verification + commit

- [ ] **Step 1: Run full example-profiles test suite**

```bash
npx vitest run tests/example-profiles.test.ts 2>&1 | tail -30
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run the full test suite to check for regressions**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all existing tests still pass. No regressions.

- [ ] **Step 3: Commit the test file**

```bash
git add tests/example-profiles.test.ts
git commit -m "test: add integration tests for all 6 example profiles and skill files"
```

- [ ] **Step 4: Final commit with test file if not yet added**

If the test file was created in Task 2 but not committed yet:

```bash
git status
git add tests/example-profiles.test.ts
git commit -m "test: add integration tests for example profiles and skills"
```
