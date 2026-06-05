# Built-in Tools

The harness ships 18 built-in tools. ACL for each is set in `tools.builtin` of the profile YAML (or inherited from `mode:`).

## ACL values

| Value | Meaning |
|-------|---------|
| `allow` | Tool executes without prompting |
| `prompt` | User must approve each call at runtime |
| `deny` | Tool call rejected immediately |

---

## File tools

### `Read`

Read a file. Returns content with line numbers (`cat -n` format).

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Absolute path to file |
| `offset` | number | no | Start line, 1-indexed (default 1) |
| `limit` | number | no | Max lines to read (default 2000) |

```json
{ "file_path": "/etc/hosts", "offset": 1, "limit": 50 }
```

---

### `Write`

Write content to a file, creating parent directories as needed.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Absolute path to file |
| `content` | string | yes | Content to write |

---

### `Edit`

Replace an exact string in a file.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Absolute path to file |
| `old_string` | string | yes | Exact text to find (must be unique unless `replace_all`) |
| `new_string` | string | yes | Replacement text |
| `replace_all` | boolean | no | Replace every occurrence (default false) |

---

### `Grep`

Search for a regex pattern in files.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | Search pattern |
| `path` | string | yes | File or directory to search |
| `flags` | string | no | grep flags (default: `-rn`) |

---

### `Glob`

Find files matching a glob pattern.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | Glob pattern (e.g. `src/**/*.ts`) |
| `cwd` | string | no | Working directory (default: `process.cwd()`) |

---

## Shell tool

### `Bash`

Execute a bash command. stdout + stderr combined.

**ACL default:** `prompt`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | yes | Shell command |
| `timeout` | number | no | Timeout in ms (max 120000, default 120000) |

---

## Skill tool

### `Skill`

Load and return a skill by name. Returns the full `SKILL.md` content.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Skill name as listed in the skill index |

---

## Memory tools

All memory tools operate on one of three scopes:

| Scope | Storage | Lifetime |
|-------|---------|---------|
| `session` | In-memory on `Session` | Until session ends |
| `profile` | `<artifact_dir>/memory/*.md` | Persistent, shared across all users |
| `user` | `~/.harness/memory/<profile>/<user>/*.md` | Persistent, private to one user |

### `MemoryRead`

**ACL default:** `allow`

| Param | Type | Required |
|-------|------|----------|
| `scope` | `session` \| `profile` \| `user` | yes |
| `key` | string | yes |

### `MemoryWrite`

Default scope is `user` (private). Use `profile` to share across all users.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `session` \| `profile` \| `user` | no | Default: `user` |
| `key` | string | yes | Short slug (e.g. `project-context`) |
| `content` | string | yes | Markdown content |
| `links` | array | no | Graph links: `[{ target: "other-key", relation: "depends_on" }]` |

### `MemoryList`

**ACL default:** `allow`

| Param | Type | Required |
|-------|------|----------|
| `scope` | `session` \| `profile` \| `user` | yes |

### `MemoryDelete`

**ACL default:** `allow`

| Param | Type | Required |
|-------|------|----------|
| `scope` | `session` \| `profile` \| `user` | yes |
| `key` | string | yes |

### `MemoryLinked`

Graph traversal — finds entries that the key links to (forward) and entries that link to the key (reverse).

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `session` \| `profile` \| `user` | yes | |
| `key` | string | yes | Anchor memory key |
| `relation` | string | no | Filter by relation type |

---

## Stats tool

### `Stats`

Show usage stats from telemetry: top tools, skills, MCP calls, cost breakdown.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `since_days` | number | no | Show last N days (default 7) |
| `profile` | string | no | Filter by profile (default: current) |

---

## Agent tools

### `Delegate`

Delegate a task to a sub-agent running under a different profile. Returns the final reply and tool summary.

**ACL default:** `prompt`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `profile` | string | yes | Target profile name (e.g. `researcher`) |
| `task` | string | yes | Task description for the sub-agent |

---

## User interaction tools

### `AskUser`

Pause the agent loop and ask the user a question. Resumes when the user responds.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | yes | Question to ask |
| `kind` | `text` \| `select` \| `multi_select` | yes | Input type |
| `options` | string[] | no | Required for `select` and `multi_select` |

### `TodoWrite`

Replace the current session todo list. Always pass the complete list — this overwrites everything.

**ACL default:** `allow`

| Param | Type | Required |
|-------|------|----------|
| `items` | `{ id, content, status, priority }[]` | yes |

`status`: `pending` \| `in_progress` \| `completed`  
`priority`: `high` \| `medium` \| `low`

### `TodoRead`

Return the current todo list as JSON.

**ACL default:** `allow`

No parameters.

---

## Code execution tool

### `ExecuteCode`

Execute code in a sandbox. Requires an `executor:` block in the profile.

**ACL default:** `allow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | yes | Source code |
| `language` | string | yes | `python`, `javascript`, `bash`, `ruby`, etc. |
| `data` | object | no | Passed to executor as `/work/data.json` |
| `timeout_ms` | number | no | Override profile `executor.timeout_ms` |

Returns: exit code, stdout, stderr, duration, and any files written to `/out/`.

```yaml
# Required in profile to enable ExecuteCode:
executor:
  default: docker
  docker_image: python:3.12-slim
  timeout_ms: 30000
```
