# Profiles

A profile is a YAML file that defines one agent instance: its model, system prompt, tools, memory, hooks, and triggers.

The installer places the bundled profiles in `~/.harness/profiles/`. A profile
directory is self-contained: its prompts and named sub-agent profiles resolve
beside the YAML file, so it can be copied or installed without a checkout.

## Minimal profile

```yaml
name: my-agent
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6
system_prompt: ./my-agent.md
artifact_dir: .harness/my-agent
```

## Field reference

### `name` _(required)_

Human-readable identifier. Shown in logs and the TUI status bar.

---

### `model` _(required)_

| Field | Type | Description |
|-------|------|-------------|
| `base_url` | URL | OpenAI-compatible endpoint. Use `https://api.anthropic.com/v1` for Anthropic. |
| `api_key_env` | string | Name of the env var holding the API key (e.g. `ANTHROPIC_API_KEY`). |
| `id` | string | Model ID passed to the API (e.g. `claude-sonnet-4-6`, `gpt-4o`). |
| `fallback_id` | string? | Model to fall back to on rate-limit or model unavailability. |

---

### `system_prompt` _(required)_

Path to a Markdown file used as the system prompt. Relative paths resolve from
the profile YAML's directory, so keep prompt assets beside their profile.
`$CWD` expands to `process.cwd()`, `~` to the home directory.

```yaml
system_prompt: ./devops.md
```

`system_prompt_voice` is optional. Audio-capable clients use it instead of
`system_prompt`; text clients retain the normal prompt.

```yaml
system_prompt_voice: ./devops-voice.md
```

Named `agents[].profile` paths resolve from the owning YAML directory too.

---

### `artifact_dir` _(required)_

Directory where the agent stores files it creates (memory, reports, drafts, etc.).

```yaml
artifact_dir: .harness/devops
```

---

### `working_dir` _(default: `$CWD`)_

Directory the agent considers its working root for relative paths.

`$CWD` deliberately means the directory from which the harness was launched;
use an absolute path when an agent must always operate in one fixed directory.

---

### `mcp` _(optional)_

Controls resource lifetime for this profile's MCP clients. MCP connects only
when the profile receives its first turn, then closes after inactivity.

```yaml
mcp:
  idle_timeout_s: 900
```

---

### `voice` _(optional)_

Declares plugin-provided streaming STT/TTS by name. The provider-specific
`config` object stays opaque to core. Plugins load from `.agents/voice/`.

```yaml
voice:
  stt: { provider: my-stt, config: {} }
  tts: { provider: my-tts, config: { voice: calm } }
  endpointing: { silence_ms: 700, max_utterance_s: 60 }
  barge_in: true
```

---

### `mode` _(optional)_

Sets the trust model and default tool ACLs. Individual `tools.builtin` overrides still apply, but **mode wins on conflict**.

| Mode | Use case | Bash | Write/Edit | ExecuteCode |
|------|----------|------|-----------|-------------|
| `developer` | Local dev, single-tenant | allow | allow | allow |
| `analyst` | Data analysis, sandboxed | deny | deny | allow |
| `assistant` | Chat assistant, multi-tenant | deny | deny | deny |
| `production` | Customer-facing, strict | deny | deny | deny |

```yaml
mode: analyst
```

> **No mode = explicit ACLs.** The example profiles in `profiles/` intentionally omit `mode:` and use explicit ACLs for full control. See the annotated example below.

---

### `safety` _(optional)_

```yaml
safety:
  enabled: true                  # static + model-based risk classification for Bash/ExecuteCode
  gate_untrusted_actions: false  # default false; true under mode: assistant / production
  gate_writes: false             # also gate write-class tools, not just outbound/destructive
  timeout_ms: 3000
  cache_ttl_hours: 168
```

`gate_untrusted_actions` is the [provenance gate](./safety#provenance-gate):
once a turn reads untrusted content (an inbound channel message, an
MCP result tagged untrusted), `outbound`/`destructive` tools escalate to
approval regardless of ACL — and neither a matching predicate nor `yolo`
mode bypasses that escalation.

---

### `tools`

```yaml
tools:
  builtin:
    Bash: allow      # allow | prompt | deny
    Write: deny
  custom:
    "*": prompt      # wildcard fallback for custom tools
  mcp_servers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: "${GITHUB_TOKEN}"
      acl:
        list_pull_requests: allow
        "*": prompt
```

An ACL entry can also be an object with argument-aware conditions instead of
a plain string — see [Safety & Governance → Conditional ACL](./safety#conditional-acl)
for the full predicate vocabulary:

```yaml
tools:
  builtin:
    Notify:
      default: prompt
      allow_if:
        - { arg: channel, in_list: trusted_channels }
lists:
  trusted_channels: [phone]
```

Built-in tool ACL defaults (when no `mode:` is set):

| Tool | Default |
|------|---------|
| Read | allow |
| Write | allow |
| Edit | allow |
| Bash | prompt |
| Grep | allow |
| Glob | allow |
| Skill | allow |
| MemoryRead | allow |
| MemoryWrite | allow |
| MemoryList | allow |
| MemoryDelete | allow |
| Stats | allow |
| Delegate | prompt |
| ExecuteCode | allow |

---

### `hooks`

Shell commands that run at tool lifecycle points. See [Hooks](./hooks) for details.

```yaml
hooks:
  pre_tool: []
  post_tool: []
  on_stop:
    - "git add .harness/writer/drafts 2>/dev/null || true"
  timeout_ms: 5000
```

---

### `improvement`

Post-session reflection and skill mining.

```yaml
improvement:
  enabled: true
  model_id: claude-haiku-4-5-20251001   # optional, defaults to profile model
  mine_skills_every_n_sessions: 10
```

---

### `context_window`

```yaml
context_window:
  max_tokens: 100000
  model_id: claude-haiku-4-5-20251001   # optional cheaper model for summarisation
```

---

### `memory`

```yaml
memory:
  provider: fs      # fs (default) | graph
```

See [Memory](./memory) for details.

---

### `max_depth`

Maximum sub-agent delegation depth. Default `2`. Prevents infinite recursive delegation.

```yaml
max_depth: 3
```

---

### `agents`

Declare sub-agent workers with typed I/O. See [Multi-Agent](./multi-agent) for details.

```yaml
agents:
  - name: researcher
    profile: ./researcher.yaml
    input:
      query: { type: string }
    output:
      findings: { type: array }
```

---

### `contract`

Typed I/O contract validated by [AJV](https://ajv.js.org) on every call to `POST /run`. Returns HTTP 422 on violation.

```yaml
contract:
  input:
    type: object
    required: [topic, format]
    properties:
      topic: { type: string }
      format: { enum: [blog, changelog, email, docs] }
  output:
    type: object
    properties:
      draft: { type: string }
```

---

### `triggers`

```yaml
triggers:
  cron: "0 8 * * *"           # daily at 08:00 (node-cron syntax)
  cron_input:
    task: "Run daily health check"
  webhook: false               # set true to enable POST /webhooks/<profile-name>

  watch:                       # filesystem-change triggers
    - name: vault
      path: "$VAULT/inbox"
      events: [add, change]    # add | change | unlink
      debounce_ms: 2000
      ignore: ["**/.obsidian/**"]
      max_batch: 50
      mode: skip                # skip | queue | parallel

  poll:                        # cursor-based polling triggers — no model call on unchanged
    - name: mail
      every: "5m"               # Ns | Nm | Nh | Nd
      probe: { tool: "gmail__list_messages", args: { q: "is:unread", max: 1 } }
      cursor_path: "messages[0].id"
      jitter_pct: 10
      mode: skip

  max_concurrent_runs: 3
  budget: { max_cost_usd: 0.50, max_tools: 30, max_wall_s: 300 }
```

> **Constraint:** `mode: developer` combined with any trigger throws a hard validation error at startup. Use explicit ACLs instead.

See [Automation](./automation#triggers) for the full triggers walkthrough and
[Safety & Governance](./safety#autonomy-budget) for how `triggers.budget` is
enforced.

---

### `channels`

A named, bidirectional transport between the profile and a human — used by
`Notify`, deferred `AskUser` questions, and approvals for unattended runs.

```yaml
channels:
  - name: phone
    transport: webhook          # or stdout, or a custom adapter under .agents/channels/
    inbound: true
    default: true
    config:
      url: "https://example.com/hooks/phone"
    acl:
      notify: allow
      approvals: true
      inbound: paired            # paired | open | off
    limits:
      max_sends_per_hour: 20
```

See [Automation → Channels](./automation#channels) for the full model.

---

### `lists`

Named lists consumed by [conditional ACL](./safety#conditional-acl) predicates
like `in_list`. Inline, or sourced from memory so a list can grow without a
profile edit:

```yaml
lists:
  trusted_channels: [phone]
  trusted_contacts: "memory:user/trusted-contacts"
```

---

### `interop`

```yaml
interop:
  a2a: false    # expose GET /.well-known/agent.json + POST /a2a
  acp: false    # expose ACP REST endpoints
```

---

### `executor`

Required to use the `ExecuteCode` tool. See [Built-in Tools](./builtin-tools#executecode).

```yaml
executor:
  default: docker          # wasm (browser Pyodide) | docker
  fallback: docker
  docker_image: python:3.12-slim
  timeout_ms: 30000
  allowed_packages:
    - pandas
    - numpy
```

---

## Annotated example — `profiles/devops.yaml`

```yaml
name: devops-agent
description: Infra health-check and ops assistant

model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-sonnet-4-6

system_prompt: ./devops.md
artifact_dir: .harness/devops

# Explicit ACLs — no mode: field, so profile has full control
tools:
  builtin:
    Bash: allow         # needs shell for health checks
    Read: allow
    Grep: allow
    Glob: allow
    Write: allow
    Edit: allow
    Skill: allow
    Stats: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    MemoryDelete: allow
    Delegate: deny      # single-agent, no delegation needed
    ExecuteCode: deny   # uses Bash instead

  mcp_servers:
    # GitHub — PR status and CI checks
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: "${GITHUB_TOKEN}"
      acl:
        list_pull_requests: allow
        get_pull_request: allow
        list_workflow_runs: allow
        "*": prompt

    # System logs — read-only, scoped to /var/log
    - name: logs
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/var/log"]
      acl:
        read_file: allow
        "*": deny

triggers:
  cron: "0 8 * * *"
  cron_input:
    task: "Run daily infra health check. Write report to reports/YYYY-MM-DD.md"
```
