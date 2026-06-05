# Memory

The harness provides persistent key-value memory with three scopes and two storage backends.

## Scopes

| Scope | Storage location | Shared? | Persistent? |
|-------|-----------------|---------|------------|
| `session` | In-memory on `Session` | No | No — cleared when session ends |
| `profile` | `<artifact_dir>/memory/*.md` | Yes — all users | Yes |
| `user` | `~/.harness/memory/<profile>/<user>/*.md` | No — private | Yes |

`MemoryWrite` defaults to `user` scope. Use `profile` to share data across all users of a profile.

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

At session start, the server reads all `profile`-scope memory and injects it into the system prompt:

```
## Shared Memory

### project-context
This project uses a pnpm monorepo...

### deployment-notes
Deploy via docker compose. Port 7337.
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
