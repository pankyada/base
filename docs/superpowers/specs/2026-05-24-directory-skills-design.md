# Directory-Based Skill Discovery — Design Spec

**Date:** 2026-05-24
**Status:** Approved

## Overview

Replace the profile-configured `skills_dirs` flat-file approach with a convention-based 4-level directory hierarchy. Skills are now directories containing a `SKILL.md` file (plus optional `scripts/`, `references/`, `assets/` subdirs), auto-discovered at startup with no profile configuration required.

## Skill Structure

```
.agents/skills/<skill-name>/
  SKILL.md          ← required; gray-matter frontmatter with name + description
  scripts/          ← optional shell/python helpers
  references/       ← optional reference documents
  assets/           ← optional images, data files
```

The `Skill` tool returns only `SKILL.md` content. The model uses the `Read` tool to access anything else inside the skill directory.

## Discovery & Merge Order

Four roots are resolved at server startup. Skills are loaded in this order (most-specific last → wins on name collision):

| Level | Path |
|-------|------|
| User | `~/.agents/skills/` |
| Project | `<git-repo-root>/.agents/skills/` |
| Sub-project | `<CWD>/../.agents/skills/` |
| Folder | `<CWD>/.agents/skills/` |

- `<git-repo-root>` is resolved via `git rev-parse --show-toplevel` (spawned as a child process). If not in a git repo, this level is silently skipped.
- `<CWD>/../.agents/skills/` and `<CWD>/.agents/skills/` always apply regardless of git state.
- Directories that don't exist are silently skipped.
- A skill directory is valid only if it contains `SKILL.md` with non-empty `name` and `description` frontmatter fields.

## Code Changes

### `src/skills/loader.ts` (full rewrite)

- Export `resolveSkillsDirs(): string[]` — computes the 4 paths, deduplicates identical paths (e.g. when CWD is repo root).
- Export `loadSkillsFromDir(dir: string): Skill[]` — scans `dir` for subdirectories containing `SKILL.md`; parses frontmatter; filters invalid entries.
- Export `loadAllSkills(dirs: string[]): Skill[]` — loads each dir in order, last-write-wins into a `Map<name, Skill>`.
- `Skill.filePath` points to the `SKILL.md` file (unchanged interface).

### `src/profiles/schema.ts`

- Remove `skills_dirs` field from `ProfileSchema`.

### `src/profiles/loader.ts`

- Remove `skills_dirs` path expansion logic.

### `src/server/index.ts`

- Replace `loadAllSkills(profile.skills_dirs)` with `loadAllSkills(resolveSkillsDirs())`.

### `profiles/coding.yaml` + `profiles/data.yaml`

- Remove `skills_dirs` key.

### `CLAUDE.md`

- Update skill discovery documentation to describe the 4-level convention.

## Unchanged

- `src/skills/indexer.ts` — skill index injection into system prompt is unchanged.
- `src/tools/builtin/skill.ts` — reads `skill.filePath` (still `SKILL.md`), no changes needed.
- `src/tools/types.ts` — `Skill` interface unchanged.

## Error Handling

- Missing or non-git directories: silently skip (no throw, no log noise).
- Invalid `SKILL.md` (missing frontmatter fields): skip that skill, continue loading others.
- Duplicate skill names: most-specific level wins; no warning needed.
