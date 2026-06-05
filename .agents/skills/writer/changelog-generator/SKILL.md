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
