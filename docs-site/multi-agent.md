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
- `name` — how the orchestrator calls the worker (e.g. `Delegate({ profile: "researcher", task: "..." })`)
- `profile` — path to the worker's profile YAML (relative to the orchestrator's profile)
- `input` / `output` — full JSON Schema objects, validated at call time

## `Delegate` tool

Dispatches a single sub-agent synchronously. Returns the worker's final reply plus a tool usage summary.

```json
Delegate({
  "profile": "researcher",
  "task": "Find the top 3 recent papers on transformer efficiency"
})
```

The worker runs its own full agent loop (with its own tools, memory, and MCP servers) and returns when complete. The orchestrator receives both the final text response and a summary of which tools the sub-agent used.

## `DelegateFanout`

Dispatch N sub-agents in parallel. Pass an array of tasks — all run concurrently, results collected when all complete.

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

Returns an array of results, each containing `{ agent, output }` or `{ agent, error }` in the same order as input tasks. Successful results include the agent's final output; failed tasks include an error message instead.

## Depth limit

`max_depth` in the profile prevents infinite recursive delegation. Default: `2`.

- Depth 0 = the orchestrator itself
- Depth 1 = first-level workers called via `Delegate` or `DelegateFanout`
- Depth 2 = workers spawned by workers (if `max_depth: 2`)

At max depth, `Delegate` calls are rejected with an error.

## Typed I/O contracts

Input and output schemas declared in the orchestrator's `agents:` block are enforced at call time:

- Before a sub-agent runs, its input is validated against the declared `input` schema. Invalid input → error returned immediately, worker not started.
- After the sub-agent completes, its output is parsed and must match the declared `output` schema. Validation errors are reported to the orchestrator.

## Example — `profiles/research.yaml`

The `research` profile demonstrates a two-worker orchestration pattern:

```yaml
name: research-orchestrator
model:
  base_url: https://api.anthropic.com/v1
  api_key_env: ANTHROPIC_API_KEY
  id: claude-opus-4-8

system_prompt: ./prompts/research.md
artifact_dir: .harness/research
max_depth: 2

tools:
  builtin:
    Delegate: allow        # orchestrator needs delegation
    DelegateFanout: allow  # or parallel delegation (optional)
    Read: allow
    Write: allow
    Bash: deny             # orchestrator doesn't run shell commands
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

**Worker profiles:**

`profiles/researcher.yaml` — fetch + brave-search MCP, no Write or Delegate. Focuses on sourcing.

`profiles/summariser.yaml` — Write allowed (artifacts only), no MCP. Focuses on synthesis.

**How the orchestrator uses them:**

1. Receives research query from user
2. `Delegate({ profile: "researcher", task: "Find sources on X" })` → gets `findings`
3. `Delegate({ profile: "summariser", task: "Summarise these findings as a report", ... })` → gets `report`
4. Returns the report to the user

Alternatively, for parallel research across multiple topics:

1. `DelegateFanout({ tasks: [ { agent: "researcher", input: { query: "topic A" } }, { agent: "researcher", input: { query: "topic B" } } ] })` → all run in parallel
2. Collect all findings, then pass to `Delegate({ profile: "summariser", ... })` for unified synthesis

## Worker profile tips

- Set `improvement.enabled: false` on workers — they run headless and don't benefit from reflection
- Deny tools the worker doesn't need (keeps ACL surface minimal)
- Omit `triggers:` on workers — they're invoked by the orchestrator, not externally
- Return structured JSON from worker final output so the orchestrator can validate and reuse results
