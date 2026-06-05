# Skills

A skill is a reusable prompt block the agent can load on demand. Skills live in directories under `.agents/skills/` — no profile configuration needed.

## Discovery

The harness auto-discovers skills from four roots at startup. Most-specific wins on name collision:

| Priority | Path | Notes |
|----------|------|-------|
| 4 (highest) | `<CWD>/.agents/skills/` | Folder-level |
| 3 | `<CWD>/../.agents/skills/` | Sub-project level |
| 2 | `<git-repo-root>/.agents/skills/` | Project level |
| 1 (lowest) | `~/.agents/skills/` | User-global |

## Directory structure

```
.agents/skills/
  security/
    vuln-patterns/
      SKILL.md          # required — loaded by the Skill tool
      references/       # optional — read with the Read tool
      scripts/          # optional shell scripts
      assets/           # optional supporting files
```

## SKILL.md format

The `SKILL.md` file uses [gray-matter](https://github.com/jonschlinkert/gray-matter) frontmatter:

```markdown
---
name: vuln-patterns
description: Checklist of common vulnerability patterns with grep signatures
---

## SQL Injection

Check for string concatenation in query construction:

```bash
grep -rn "SELECT.*+\|query.*concat\|\"SELECT" src/
```

Expected safe pattern: parameterized queries only.
```

**Required frontmatter fields:**

| Field | Description |
|-------|-------------|
| `name` | Unique skill name. Used by the `Skill` tool. |
| `description` | One-line summary. Injected into the agent's system prompt as a hint. |

## Using a skill

The agent calls the `Skill` tool with the skill name:

```
Skill({ name: "vuln-patterns" })
```

The full `SKILL.md` content is returned. For files in subdirectories (`references/`, `assets/`), use the `Read` tool with an explicit path.

## Example — `security/vuln-patterns`

```markdown
---
name: vuln-patterns
description: SQLi, path traversal, hardcoded secrets, unsafe deserialization — grep signatures
---

## SQL Injection

```bash
grep -rn "query.*+\|execute.*format\|SELECT.*%s" src/
```

## Path Traversal

```bash
grep -rn "\.\./\|path\.join.*req\.\|__dirname.*req\." src/
```

## Hardcoded Secrets

```bash
grep -rn "password\s*=\s*['\"][^'\"]\|api_key\s*=\s*['\"]" src/
```
```
