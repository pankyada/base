# Multi-Agent Composition — Design Spec

**Date:** 2026-05-30
**Feature:** ROADMAP #3 — First-class multi-agent composition
**Status:** Approved, pending implementation

---

## Overview

Extend the harness so any profile can declare a registry of named sub-agents. The orchestrating agent gets:

- A per-agent tool for each registry entry (single sequential call)
- A `DelegateFanout` builtin for explicit parallel batches
- Hard input/output schema validation (JSON Schema via `ajv`)
- Configurable delegation depth (default 2)

The existing `Delegate` tool remains unchanged as an escape hatch for one-off unregistered profiles.

---

## Profile Schema

Two new fields on `ProfileSchema`:

```yaml
max_depth: 2          # optional; default 2. Root profile's value is authoritative — sub-profiles' max_depth is ignored during nested calls.

agents:
  - name: researcher           # becomes a tool named "researcher"
    profile: ./profiles/researcher.yaml   # ~ and $CWD expansion supported
    input:                     # JSON Schema; validated before sub-agent runs
      type: object
      properties:
        query: { type: string }
      required: [query]
    output:                    # JSON Schema; validated before result returned
      type: object
      properties:
        findings: { type: string }
      required: [findings]

  - name: writer
    profile: ./profiles/writer.yaml
    input:
      type: object
      properties:
        topic: { type: string }
        tone: { type: string, enum: [formal, casual] }
      required: [topic]
    output:
      type: object
      properties:
        content: { type: string }
      required: [content]
```

- `name` must be unique within the `agents:` list.
- `input` and `output` are standard JSON Schema objects (draft-07 compatible).
- Both fields are required per entry — no schema means no validation guarantee, which violates the hard-enforcement contract.

---

## Session Initialisation

On each new session (`src/server/index.ts`), after loading the profile:

1. For each entry in `profile.agents`:
   - Resolve the sub-profile path (same `~` / `$CWD` expansion used elsewhere).
   - Load with `loadProfile()`.
   - Compile `input` and `output` schemas into `ajv` validator functions (cached on the entry; done once per session init).
   - Build a `ToolDefinition`: `name = entry.name`, `parameters = entry.input`.
2. Store the resulting `ToolDefinition[]` on `ToolContext` as `agentTools`.

If any sub-profile fails to load, session init throws — the orchestrator profile is misconfigured.

---

## Agent Loop Integration

`src/loop/agent-loop.ts` line that builds `allTools` changes from:

```typescript
const allTools = [...getAllTools(), ...getMcpToolDefinitions(profile, context.mcpEntries ?? [])]
```

to:

```typescript
const allTools = [
  ...getAllTools(),
  ...getMcpToolDefinitions(profile, context.mcpEntries ?? []),
  ...(context.agentTools ?? []),
]
```

Per-agent tools and `DelegateFanout` participate in the existing ACL system. Both default to `prompt` in `BuiltinToolsSchema`. The existing parallel tool execution (Strategy C) handles fan-out automatically when the LLM emits multiple per-agent tool calls in one turn.

---

## Per-Agent Tool Execution

Each named-agent tool's `execute` function follows this sequence:

1. **Input validation** — run compiled `ajv` validator against `input`. If invalid, return error string immediately; sub-agent never runs.
2. **Depth check** — if `context.delegateDepth >= context.maxDepth` (root profile's `max_depth`, threaded through `ToolContext`), return depth-limit error.
3. **Task serialisation** — serialize validated input as JSON and append an output format instruction (e.g. `\n\nRespond with a JSON object matching this schema: <output schema>`) to form the `userMessage` passed to `runAgentLoop`. This is appended to the user message, not the sub-agent's system prompt file.
4. **Run** — same mechanics as existing `Delegate`: load sub-profile, create session, create memory provider, run loop with `delegateDepth + 1`.
5. **Output parsing** — extract final assistant message; attempt `JSON.parse`. If unparseable, return parse error.
6. **Output validation** — run compiled `ajv` validator against parsed output. If invalid, return validation error.
7. **Return** — return validated output as JSON string.

---

## DelegateFanout Tool

New builtin at `src/tools/builtin/delegate-fanout.ts`.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "agent": { "type": "string" },
          "input": { "type": "object" }
        },
        "required": ["agent", "input"]
      }
    }
  },
  "required": ["tasks"]
}
```

**Execution:** All tasks run via `Promise.all`. Each task follows the same 7-step sequence as a per-agent tool call. If a task fails (validation or runtime), that slot returns `{ "agent": "...", "error": "..." }`; other tasks still complete.

**Output:**

```json
{
  "results": [
    { "agent": "researcher", "output": { "findings": "..." } },
    { "agent": "writer", "error": "Input validation failed: 'topic' is required" }
  ]
}
```

---

## Depth Enforcement

- Root orchestrator: `delegateDepth = 0`, `maxDepth = profile.max_depth`.
- Each delegation increments `delegateDepth`; sub-agent runs with `delegateDepth + 1` and the same `maxDepth` value.
- `maxDepth` is set once from the **root profile** and passed unchanged through `ToolContext`. Sub-agent profiles' own `max_depth` is not read during nested calls.
- `DelegateFanout` tasks all get `delegateDepth + 1` — fan-out is width, not depth.
- Default `max_depth: 2` → orchestrator → worker → one more level.
- Setting `max_depth: 1` restores the current flat single-delegation behavior.

---

## Schema Validation

New dependency: `ajv` (JSON Schema draft-07, no additional formats needed).

Validators are compiled once at session init from the JSON Schema objects in the `agents:` block. Compiled validators are stored on the resolved agent entries (not re-compiled per call).

No other new dependencies.

---

## Files Changed

| File | Change |
|------|--------|
| `src/profiles/schema.ts` | Add `max_depth` (number, default 2) and `agents` array (name, profile, input schema, output schema) to `ProfileSchema` |
| `src/tools/types.ts` | Add `agentTools?: ToolDefinition[]` and `maxDepth?: number` to `ToolContext` |
| `src/loop/agent-loop.ts` | Spread `context.agentTools ?? []` into `allTools` |
| `src/tools/builtin/index.ts` | Register `DelegateFanout` builtin |
| `src/server/index.ts` | On session init: call `loadAgentTools(profile, context)`, set result on context |
| `src/tools/builtin/delegate-fanout.ts` | **New** — `DelegateFanout` tool definition |
| `src/agents/loader.ts` | **New** — `loadAgentTools()`: resolves profiles, compiles schemas, returns `ToolDefinition[]` |
| `src/agents/runner.ts` | **New** — `runSubAgent()`: shared 7-step execute logic used by per-agent tools and `DelegateFanout` |
| `docs/ROADMAP.md` | Mark #3 as `🔄 In progress` |

`src/tools/builtin/delegate.ts` — **unchanged**.

---

## Out of Scope

- Sub-agent streaming tokens back to parent (sub-agent output is returned as a single result, not streamed token-by-token)
- Cross-agent shared memory (each sub-agent gets its own memory scope)
- Sub-agent skill discovery (sub-agent loads its own skills independently)
- Typed contracts for the existing `Delegate` tool
