# Use cases

Four complete, runnable profiles for four different jobs. Each one is real
YAML — copy it into `~/.harness/profiles/<name>.yaml` (plus a `<name>.md`
prompt beside it) and run it. They're ordered from simplest to most
autonomous, and each builds on concepts from the previous one.

Prefer to watch first? **[How it Works](./how-it-works)** animates each of
these four scenarios beat by beat before you read the YAML.

| # | Profile | Trust model | Runs how |
|---|---|---|---|
| 1 | [Coding assistant](#1-coding-assistant) | `developer` — you're in the loop | Interactive, TUI |
| 2 | [Personal assistant with voice](#2-personal-assistant-with-voice) | `assistant` — private, one user | Interactive, voice channel |
| 3 | [Production data-analysis agent](#3-production-data-analysis-agent) | `production` — read-only, contracted | REST, called by other services |
| 4 | [Unattended ops agent](#4-unattended-ops-agent) | `production` + budget — nobody watching | Cron/watch/poll triggers |

---

## 1. Coding assistant

**Goal:** a local dev assistant that reads, writes, and runs code in the
repo you launch it from, asks before running shell commands, and routes
work through cheap→frontier model tiers automatically.

This is the bundled `profiles/coding.yaml` — install it and it just works:

```bash
curl -fsSL https://raw.githubusercontent.com/pankyada/base/main/scripts/install.sh | sh
export OPENAI_API_KEY='...'
harness-tui
```

```yaml
name: coding
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-5.4-mini-2026-03-17
models:
  roles: { cheap: gpt-5.6-luna, balanced: gpt-5.6-terra, frontier: gpt-5.6-sol, critic: claude-sonnet-5 }
workflow:
  enabled: true
  playbook: coding
  routing:
    table: { recon: cheap, plan: balanced, design: balanced, build: balanced, verify: cheap, review: critic }
system_prompt: ./coding.md
working_dir: $CWD
artifact_dir: .harness/coding
tools:
  builtin:
    Read: allow
    Write: allow
    Edit: allow
    Bash: prompt
    ExecuteCode: allow
    Delegate: prompt
  mcp_servers: []
improvement:
  enabled: true
  mine_skills_every_n_sessions: 10
```

**Why these choices:**
- No `mode:` — explicit ACLs instead, so you can see exactly what's allowed
  rather than trusting a preset. `Bash: prompt` is the one thing that always
  asks, because shell commands are the highest-variance action a coding
  agent takes.
- `working_dir: $CWD` is deliberate runtime input — start Harness in the
  repo you want it to work on; the same profile works everywhere.
- `workflow.enabled` routes simple asks through the `cheap` tier and
  escalates to `frontier`/`critic` only when a task's own recon/review
  stages call for it — see [Architecture → Adaptive Workflow Router](./architecture).
- `improvement.enabled` means it gets measurably better at *this* codebase
  over sessions — see [Self-Improvement](./self-improvement).

No triggers, no channels, no budget: a human is watching the whole time, so
none of the unattended-autonomy machinery in [Safety & Governance](./safety)
is load-bearing here.

---

## 2. Personal assistant with voice

**Goal:** a private assistant you talk to, that can text you when it needs
an answer instead of only working while you're staring at a screen, and
that remembers things with an actual expiration date instead of forever.

```yaml
name: assistant
mode: assistant
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6
system_prompt: ./assistant.md
system_prompt_voice: ./assistant-voice.md
working_dir: $CWD
artifact_dir: .harness/assistant

voice:
  stt: { provider: local-stt, config: {} }
  tts: { provider: local-tts, config: { voice: calm } }
  endpointing: { silence_ms: 700, max_utterance_s: 60 }
  barge_in: true

channels:
  - name: phone
    transport: webhook
    inbound: true
    default: true
    config: { url: "https://example.com/hooks/phone" }
    acl:
      notify: allow
      approvals: true
      inbound: paired

tools:
  builtin:
    Read: allow
    Write: allow
    Recall: allow
    Notify: allow
    AskUser: allow
  mcp_servers: []

memory:
  provider: fs
```

Ask it something that should expire, and it will:

```
AskUser({
  prompt: "Should I remind you about the dentist tomorrow at 9am?",
  kind: "select", options: ["yes", "no"],
  defer: true, ttl: "12h", channel: "phone"
})
```

**Why these choices:**
- `mode: assistant` sets tight default ACLs for a multi-context personal
  tool (no shell, no code execution) — see
  [Safety & Governance → Instance modes](./safety#instance-modes).
- A voice provider is a plugin, not a core dependency — drop a module in
  `.agents/voice/local-stt/` and `.agents/voice/local-tts/` and reference it
  by name. See [Voice](./voice) for the protocol and barge-in behavior.
- The `phone` channel is what makes `AskUser({ defer: true })` and `Notify`
  actually reach you when you're not connected — see
  [Automation → Channels](./automation#channels). `inbound: paired` means
  only you can answer, not anyone who finds the webhook URL.
- `Recall` (not just `MemoryRead`) matters here specifically because a
  personal assistant accumulates facts with real expiration dates — "pick up
  the package by Friday," "on vacation until the 12th." See
  [Memory → Temporal memory and Recall](./memory#temporal-memory-and-recall).

Nothing here has a spend ceiling, because every run is you talking to it
live — same reasoning as the coding assistant. That changes in the next two
examples, where nobody's watching.

---

## 3. Production data-analysis agent

**Goal:** a read-only agent other services call over REST with a fixed
input/output shape, that can never write or execute anything, and that
fails loudly (422) rather than guessing when called wrong.

Based on the bundled `profiles/data.yaml`, hardened for production:

```yaml
name: data
mode: production
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
  fallback_id: gpt-4o-mini
system_prompt: ./data.md
working_dir: $CWD
artifact_dir: .harness/data

tools:
  builtin:
    Read: allow
    Grep: allow
    Glob: allow
    MemoryRead: allow
    MemoryWrite: allow
    Write: deny
    Edit: deny
    Bash: deny
    ExecuteCode: deny
  mcp_servers: []

contract:
  input:
    type: object
    required: [dataset_path, question]
    properties:
      dataset_path: { type: string }
      question: { type: string }
  output:
    type: object
    properties:
      answer: { type: string }
      confidence: { type: number }

triggers:
  budget: { max_cost_usd: 0.30, max_tools: 15, max_wall_s: 60 }
```

```bash
curl -X POST http://localhost:7337/run \
  -H 'content-type: application/json' \
  -d '{"profile":"data","input":{"dataset_path":"./q3.csv","question":"revenue trend?"}}'
```

**Why these choices:**
- `mode: production` plus explicit `deny` on `Write`/`Edit`/`Bash`/
  `ExecuteCode` — belt and suspenders. The mode sets the default, the
  explicit entries make the read-only guarantee visible without reading the
  mode table. See [Safety & Governance → Instance modes](./safety#instance-modes).
- `contract` means a malformed caller request gets HTTP 422 with a clear
  reason instead of the model guessing at missing fields — see
  [Profiles → contract](./profiles#contract).
- `triggers.budget` bounds cost even on REST-invoked runs — a caller with a
  bug that loops `POST /run` can't run up an unbounded bill. See
  [Safety & Governance → Autonomy budget](./safety#autonomy-budget).
- No channels, no `AskUser`: this profile is called by *code*, not a human
  waiting for a question back. `Bash: deny` here isn't optional the way it
  was `prompt` in the coding profile — there is no one present to answer a
  prompt.

---

## 4. Unattended ops agent

**Goal:** an agent that watches infrastructure without anyone running it —
a daily health-check plus a live watch on error logs — that can page you
through a channel, and that cannot silently blow past a spend limit if it
gets stuck in a loop at 3am.

Based on the bundled `profiles/devops.yaml`, extended with `watch`, a
budget, and a channel:

```yaml
name: devops
mode: production
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6
system_prompt: ./devops.md
working_dir: $CWD
artifact_dir: .harness/devops

tools:
  builtin:
    Read: allow
    Grep: allow
    Bash: allow
    Notify:
      default: prompt
      allow_if:
        - { arg: channel, in_list: trusted_channels }
    Write: deny
    ExecuteCode: deny
  mcp_servers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }
      acl: { list_pull_requests: allow, "*": prompt }

lists:
  trusted_channels: [oncall]

channels:
  - name: oncall
    transport: webhook
    default: true
    config: { url: "https://example.com/hooks/oncall" }
    acl: { notify: allow, approvals: true, inbound: off }

triggers:
  cron: "0 8 * * *"
  cron_input:
    task: "Daily infra health check: disk usage, top memory consumers, open PRs."
  watch:
    - name: error-log
      path: "/var/log/app"
      events: [change]
      debounce_ms: 5000
      max_batch: 20
  max_concurrent_runs: 2
  budget: { max_cost_usd: 1.00, max_tools: 40, max_wall_s: 300 }
```

**Why these choices:**
- `Notify` uses [conditional ACL](./safety#conditional-acl) instead of a
  blanket `allow` — this agent can page `oncall` and nothing else, ever,
  without a human approving each message.
- `watch` on the error log means a spike in errors triggers a real run;
  everything else — the far more common case of "nothing changed" — costs
  nothing, because the watcher itself never calls the model. See
  [Automation → Triggers](./automation#triggers).
- `triggers.budget` is what stops a bad night from becoming a bad bill: if
  the health check gets stuck in a retry loop, it aborts at `$1.00` with the
  partial output preserved and `oncall` notified of what was in flight — see
  [Safety & Governance → Autonomy budget](./safety#autonomy-budget).
- `max_concurrent_runs: 2` caps a burst of watch events from spawning
  unlimited parallel runs on a shared box.
- Every effectful call here — the health check's own file reads, the PR
  lookup, the page to oncall — lands in the audit journal with why it was
  allowed. If a 3am page turns out to be wrong, `harness audit --since` is
  the first thing to check.

For a fifth pattern — a **webhook-triggered, contract-validated code
auditor** that fires on every CI push — see the bundled `profiles/security.yaml`
in the repo; it combines ideas from examples 3 and 4 (contract + read-only)
with `triggers.webhook` instead of `cron`.

## See also

- [Profiles](./profiles) — full field reference for everything used above
- [Safety & Governance](./safety) · [Automation](./automation) · [Voice](./voice) · [Memory](./memory)
- [Multi-Agent](./multi-agent) — composing several of these profiles together, e.g. a coding orchestrator that delegates to a read-only data-analysis worker
