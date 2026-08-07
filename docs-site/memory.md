# Memory

The harness provides persistent key-value memory with three scopes and two storage backends. Facts can also carry validity intervals instead of being implicitly eternal — see [Temporal memory](#temporal-memory-and-recall) below.

## Scopes

| Scope | Storage location | Shared? | Persistent? |
|-------|-----------------|---------|------------|
| `session` | In-memory on `Session` | No | No — cleared when session ends |
| `profile` | `<artifact_dir>/memory/*.md` | Yes — all users | Yes |
| `user` | `<artifact_dir>/users/<user>/memory/*.md` | No — private per-user | Yes |
| `project` | `~/.harness/projects/<user>/<projectId>/memory/*.md` | No — private per-project | Yes |

`MemoryWrite` defaults to `user` scope. Use `profile` to share data across all users of a profile. Use `project` to store data scoped to a specific project context.

## Providers

Configure the provider in the profile:

```yaml
memory:
  provider: fs      # default
```

### `fs` — filesystem provider

Memories stored as Markdown files. Each file has gray-matter frontmatter for links.

```
<artifact_dir>/memory/
  project-context.md
  deployment-notes.md
```

### `graph` — graph provider

Memories stored in a single `graph.json` file with nodes and typed relation edges. Enables `MemoryLinked` graph traversal.

```
<artifact_dir>/memory/
  graph.json        # { nodes: [...], edges: [...] }
```

## Graph links

Both providers support links between memories:

```json
MemoryWrite({
  "key": "auth-service",
  "content": "JWT-based auth, keys rotate weekly",
  "links": [
    { "target": "user-service", "relation": "depends_on" },
    { "target": "session-store", "relation": "relates_to" }
  ]
})
```

## MemoryLinked — graph traversal

`MemoryLinked` traverses the link graph in both directions:

```json
MemoryLinked({ "scope": "user", "key": "auth-service" })
```

Returns:
- **Forward:** entries that `auth-service` links to
- **Reverse:** entries that link to `auth-service`

Filter by relation type:

```json
MemoryLinked({
  "scope": "user",
  "key": "auth-service",
  "relation": "depends_on"
})
```

## System prompt injection

At session start, the server reads memory from up to three scopes and injects them into the system prompt:

- **`profile` (shared)** — injected as `## Memory (shared)` — visible to all users of the profile
- **`user` (private)** — injected as `## Memory (yours)` — private to the current user
- **`project`** — injected as `## Memory (project)` — only included when the session has a non-`inbox` project set

Example injected section:

```
## Memory (shared)

- **project-context**: This project uses a pnpm monorepo...
- **deployment-notes**: Deploy via docker compose. Port 7337.

## Memory (yours)

- **perf-issue**: N+1 query in /api/users — fix with eager load

## Memory (project)

- **sprint-goal**: Ship auth v2 by end of week
```

This means the agent always has context from previous sessions without an explicit `MemoryRead` call.

## Example workflow

```
# Agent stores a finding
MemoryWrite({ key: "perf-issue", content: "N+1 query in /api/users — fix with eager load" })

# Later session — agent recalls it
MemoryRead({ scope: "user", key: "perf-issue" })
# → "N+1 query in /api/users — fix with eager load"

# Browse all user memory
MemoryList({ scope: "user" })
# → - **perf-issue**: N+1 query in /api/users...
```

## Temporal memory and Recall

`MemoryRead`/`MemoryWrite` treat every fact as implicitly eternal and
implicitly current — correct for "the user prefers TypeScript," wrong for
almost everything else an assistant learns: a flight date, a manager who
changes in March, last quarter's budget. Acting on a stale fact confidently
is worse than having no memory at all, because the agent uses it anyway.

Temporal fields are optional frontmatter, fully backward compatible — a file
with none of them means exactly what it always meant: valid forever, at full
confidence.

```yaml
---
valid_from: 2026-08-14T00:00:00+05:30
valid_until: 2026-08-21T00:00:00+05:30
timezone: Asia/Kolkata
entity: travel/delhi-trip
confidence: 0.9
supersedes: travel-delhi-trip-v1
recur: "FREQ=WEEKLY;BYDAY=MO"     # optional — bounded RRULE subset, no external dependency
---
Flight AI-812 to Delhi, 14th, 09:40 IST. Return on the 21st.
```

`Recall` is the time-aware query surface — `MemoryRead` stays a direct key
fetch, unchanged:

```
Recall({
  at: "2026-08-15T10:00:00+05:30",   # instant; defaults to now
  window: "next 7d",                  # or "last 30d", or an ISO range joined with ..
  entity: "travel/",                  # exact or prefix
  relation: "manager",                # traverse memory links, like MemoryLinked
  text: "kyoto",                      # lexical filter
  scope: "user",
  limit: 20
})
```

Evaluation filters before it ranks: scope → temporal validity → entity/
relation → lexical → **supersession collapse** → rank → limit. Within one
`entity`, when several facts are valid at `at`, the one with the latest
`valid_from` wins and the others drop from *this result only* — nothing is
ever deleted from disk, and `Recall({ at: <past> })` still returns the
historical answer. Timestamps are always stored with an explicit offset,
never naive, because "9am standup" means 9am *somewhere* and a traveling
user breaks any design that silently normalizes to UTC.

Context projection uses the same metadata to make eviction smarter than
plain recency: expired facts (`valid_until` passed) are the cheapest thing
to drop and evict first; superseded facts demote out of the live prompt but
stay recallable at a past instant; facts becoming valid within 24h are
pinning candidates — "your flight is tomorrow" is exactly what should
survive compaction. See [Context Projection](./context) for how eviction
works end to end.
