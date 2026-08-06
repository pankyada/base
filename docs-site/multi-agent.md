# Multi-Agent Composition

Any profile can be called as a tool by another agent. An orchestrator spawns workers, collects results, and synthesises the output.

## The `agents:` block

Declare named sub-agents with typed I/O contracts in the profile:

```yaml
agents:
  - name: researcher
    profile: ./researcher.yaml
    input:
      type: object
      required:
        - query
      properties:
        query: { type: string }
        sources: { type: array, items: { type: string } }
    output:
      type: object
      required:
        - findings
      properties:
        findings: { type: array }

  - name: summariser
    profile: ./summariser.yaml
    input:
      type: object
      required:
        - findings
      properties:
        findings: { type: array }
        format: { type: string }
    output:
      type: object
      required:
        - report
      properties:
        report: { type: string }
```

Each `agents:` entry declares:
- `name` — becomes a **named tool** the orchestrator calls directly (e.g. `researcher({ "query": "..." })`)
- `profile` — path to the worker's profile YAML (relative to the orchestrator's profile)
- `input` / `output` — full JSON Schema objects, validated at call time

When `agents:` is declared, the harness registers one tool per entry using the entry's `name`. The orchestrator invokes workers by calling those tools directly — **not** via the standalone `Delegate` tool. A `DelegateFanout` tool is also injected automatically for parallel dispatch.

## Calling named agent tools

Each entry in `agents:` becomes a callable tool with the agent's name. The tool accepts the fields declared in the entry's `input` schema:

```json
researcher({ "query": "transformer efficiency" })
```

```json
summariser({ "findings": [...], "format": "markdown" })
```

The tool runs the worker's full agent loop and returns the worker's output as a JSON string matching the declared `output` schema.

## `Delegate` tool (standalone, no `agents:` block)

`Delegate` is a **separate built-in tool** for ad-hoc profile calls when no `agents:` block is declared. It dispatches a single sub-agent by profile name with a free-text task description. Returns the worker's final reply plus a tool usage summary.

```json
Delegate({
  "profile": "researcher",
  "task": "Find the top 3 recent papers on transformer efficiency"
})
```

Use `Delegate` when you need to call a worker on the fly without pre-declaring typed I/O contracts. The worker runs its own full agent loop and returns when complete.

> **Note:** `Delegate` has a hardcoded depth limit of 1 — sub-agents called via `Delegate` cannot delegate further.

## `DelegateFanout`

Dispatch N named sub-agents in parallel. `DelegateFanout` is automatically available when `agents:` is declared — no extra configuration needed. Pass an array of tasks — all run concurrently, results collected when all complete.

```json
DelegateFanout({
  "tasks": [
    { "agent": "researcher", "input": { "query": "transformer efficiency" } },
    { "agent": "researcher", "input": { "query": "quantization techniques" } },
    { "agent": "researcher", "input": { "query": "mixture-of-experts architectures" } }
  ]
})
```

Each task specifies:
- `agent` — name of a sub-agent declared in the orchestrator's `agents:` block
- `input` — an object matching that agent's declared `input` schema

Returns an array of results in the same order as the input tasks, each containing `{ agent, output }` or `{ agent, error }`. Successful results include the agent's validated output object; failed tasks include an error message instead.

## Depth limit

`max_depth` in the orchestrator's profile prevents infinite recursive delegation. Default: `2`.

- Depth 0 = the orchestrator itself
- Depth 1 = first-level workers called via named agent tools or `DelegateFanout`
- Depth 2 = workers spawned by workers (if `max_depth: 2`)

At max depth, further delegation is rejected with an error. Set `max_depth` in the profile:

```yaml
max_depth: 3  # allow three levels of nesting
```

## Typed I/O contracts

Input and output schemas declared in the orchestrator's `agents:` block are enforced at call time:

- Before a sub-agent runs, its input is validated against the declared `input` schema. Invalid input → error returned immediately, worker not started.
- After the sub-agent completes, its output is parsed and must match the declared `output` schema. Validation errors are reported to the orchestrator.

## Example — `profiles/research.yaml`

The `research` profile demonstrates a two-worker orchestration pattern:

```yaml
name: research
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-opus-4-8

system_prompt: ./research.md
artifact_dir: .harness/research

tools:
  builtin:
    Read: allow
    Grep: allow
    Glob: allow
    Write: deny
    Bash: deny
    ExecuteCode: deny

agents:
  - name: researcher
    profile: ./researcher.yaml
    input:
      type: object
      required: [query]
      properties:
        query: { type: string }
        sources: { type: array, items: { type: string } }
    output:
      type: object
      required: [findings]
      properties:
        findings: { type: array }

  - name: summariser
    profile: ./summariser.yaml
    input:
      type: object
      required: [findings]
      properties:
        findings: { type: array }
        format: { type: string, enum: [markdown, html, plain] }
    output:
      type: object
      required: [report]
      properties:
        report: { type: string }
```

Named agent tools (`researcher`, `summariser`) and `DelegateFanout` are injected automatically from the `agents:` block — no `tools.builtin` entries needed for them.

**Worker profiles:**

`profiles/researcher.yaml` — fetch + brave-search MCP, no Write or Delegate. Focuses on sourcing.

`profiles/summariser.yaml` — Write allowed (artifacts only), no MCP. Focuses on synthesis.

**How the orchestrator uses them:**

1. Receives research query from user
2. `researcher({ "query": "Find sources on X" })` → returns `{ "findings": [...] }`
3. `summariser({ "findings": [...], "format": "markdown" })` → returns `{ "report": "..." }`
4. Returns the report to the user

Alternatively, for parallel research across multiple topics:

1. `DelegateFanout({ "tasks": [ { "agent": "researcher", "input": { "query": "topic A" } }, { "agent": "researcher", "input": { "query": "topic B" } } ] })` → all run in parallel
2. Collect all findings, then pass to `summariser({ "findings": [...], "format": "markdown" })` for unified synthesis

## Worker profile tips

- Set `improvement.enabled: false` on workers — they run headless and don't benefit from reflection
- Deny tools the worker doesn't need (keeps ACL surface minimal)
- Omit `triggers:` on workers — they're invoked by the orchestrator, not externally
- Return structured JSON from worker final output so the orchestrator can validate and reuse results
