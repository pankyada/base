# Directory-Based Skill Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace profile-configured `skills_dirs` flat-file skill loading with a convention-based 4-level `.agents/skills/<name>/SKILL.md` directory hierarchy, auto-discovered at startup.

**Architecture:** A `resolveSkillsDirs()` function computes 4 paths (`~/.agents/skills`, git-repo-root, CWD/.., CWD) at startup; `loadSkillsFromDir` scans each for subdirectories containing `SKILL.md`; `loadAllSkills` merges them with most-specific-last wins. Profile schema drops `skills_dirs` entirely.

**Tech Stack:** TypeScript, Node.js `fs`/`child_process`, `gray-matter`, `vitest`

---

### Task 1: Rewrite `src/skills/loader.ts`

**Files:**
- Modify: `src/skills/loader.ts`
- Modify: `tests/skills.test.ts`

- [ ] **Step 1: Replace the test file with failing tests for the new behaviour**

```typescript
// tests/skills.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { loadSkillsFromDir, loadAllSkills, resolveSkillsDirs } from '../src/skills/loader.js'
import { buildSkillIndex } from '../src/skills/indexer.js'

// Helper: create a skill directory with SKILL.md
function makeSkillDir(root: string, skillName: string, name: string, description: string) {
  const skillDir = join(root, skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nContent here.`)
  return skillDir
}

describe('loadSkillsFromDir', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'skills-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('loads a skill from a subdirectory containing SKILL.md', () => {
    makeSkillDir(root, 'my-skill', 'my-skill', 'does the thing')
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('my-skill')
    expect(skills[0].description).toBe('does the thing')
    expect(skills[0].filePath).toContain('SKILL.md')
  })

  it('skips subdirectories with no SKILL.md', () => {
    mkdirSync(join(root, 'empty-dir'))
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(0)
  })

  it('skips SKILL.md missing name or description frontmatter', () => {
    const d = join(root, 'bad-skill')
    mkdirSync(d)
    writeFileSync(join(d, 'SKILL.md'), `---\nname: only-name\n---\n# content`)
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(0)
  })

  it('ignores regular .md files at root level (not inside subdirs)', () => {
    writeFileSync(join(root, 'flat.md'), `---\nname: flat\ndescription: flat skill\n---`)
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(0)
  })

  it('returns empty array for non-existent directory', () => {
    const skills = loadSkillsFromDir('/nonexistent/path/that/does/not/exist')
    expect(skills).toHaveLength(0)
  })
})

describe('loadAllSkills', () => {
  let dir1: string, dir2: string
  beforeEach(() => {
    dir1 = mkdtempSync(join(tmpdir(), 'skills-a-'))
    dir2 = mkdtempSync(join(tmpdir(), 'skills-b-'))
  })
  afterEach(() => {
    rmSync(dir1, { recursive: true, force: true })
    rmSync(dir2, { recursive: true, force: true })
  })

  it('later dir overrides earlier on name collision (most-specific wins)', () => {
    makeSkillDir(dir1, 'shared', 'shared', 'global version')
    makeSkillDir(dir2, 'shared', 'shared', 'local version')
    const skills = loadAllSkills([dir1, dir2])
    expect(skills).toHaveLength(1)
    expect(skills[0].description).toBe('local version')
  })

  it('merges unique skills from multiple dirs', () => {
    makeSkillDir(dir1, 'skill-a', 'skill-a', 'from dir1')
    makeSkillDir(dir2, 'skill-b', 'skill-b', 'from dir2')
    const skills = loadAllSkills([dir1, dir2])
    expect(skills).toHaveLength(2)
  })

  it('handles empty dirs array', () => {
    expect(loadAllSkills([])).toEqual([])
  })
})

describe('resolveSkillsDirs', () => {
  it('returns an array of strings', () => {
    const dirs = resolveSkillsDirs()
    expect(Array.isArray(dirs)).toBe(true)
    dirs.forEach(d => expect(typeof d).toBe('string'))
  })

  it('includes ~/.agents/skills as first entry', () => {
    const dirs = resolveSkillsDirs()
    expect(dirs[0]).toBe(join(homedir(), '.agents', 'skills'))
  })

  it('returns no duplicate paths', () => {
    const dirs = resolveSkillsDirs()
    expect(new Set(dirs).size).toBe(dirs.length)
  })
})

describe('buildSkillIndex', () => {
  it('builds index string from skills', () => {
    const index = buildSkillIndex([{ name: 'foo', description: 'does foo', content: '', filePath: '' }])
    expect(index).toContain('foo')
    expect(index).toContain('does foo')
  })

  it('returns empty string when no skills', () => {
    expect(buildSkillIndex([])).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && npx vitest run tests/skills.test.ts
```

Expected: multiple FAIL — `resolveSkillsDirs` not exported, `loadSkillsFromDir` returns wrong results for new structure.

- [ ] **Step 3: Rewrite `src/skills/loader.ts`**

```typescript
// src/skills/loader.ts
import matter from 'gray-matter'
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import type { Skill } from '../tools/types.js'

export type { Skill }

/** Resolve git repo root; returns null if not in a git repo. */
function getGitRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { stdio: 'pipe' })
      .toString()
      .trim()
  } catch {
    return null
  }
}

/**
 * Compute the 4-level .agents/skills discovery paths.
 * Order: home → git-repo-root → CWD/.. → CWD  (most-specific last → wins on collision)
 * Duplicate paths are removed while preserving order.
 */
export function resolveSkillsDirs(): string[] {
  const cwd = process.cwd()
  const candidates: string[] = [
    join(homedir(), '.agents', 'skills'),
  ]
  const gitRoot = getGitRoot()
  if (gitRoot) candidates.push(join(gitRoot, '.agents', 'skills'))
  candidates.push(join(resolve(cwd, '..'), '.agents', 'skills'))
  candidates.push(join(cwd, '.agents', 'skills'))

  // Deduplicate while preserving order
  const seen = new Set<string>()
  return candidates.filter(p => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

/**
 * Load all skills from a single root directory.
 * Each skill must be a subdirectory containing SKILL.md with name + description frontmatter.
 */
export function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(entry => {
      const full = join(dir, entry)
      return statSync(full).isDirectory()
    })
    .flatMap(entry => {
      const skillMd = join(dir, entry, 'SKILL.md')
      if (!existsSync(skillMd)) return []
      const raw = readFileSync(skillMd, 'utf-8')
      const { data } = matter(raw)
      const name = data.name as string | undefined
      const description = data.description as string | undefined
      if (!name || !description) return []
      return [{
        name,
        description,
        content: raw,
        filePath: skillMd,
      } satisfies Skill]
    })
}

/**
 * Load and merge skills from multiple root directories.
 * Later directories override earlier ones for the same skill name.
 */
export function loadAllSkills(dirs: string[]): Skill[] {
  const byName = new Map<string, Skill>()
  for (const dir of dirs) {
    for (const skill of loadSkillsFromDir(dir)) {
      byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && npx vitest run tests/skills.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/skills/loader.ts tests/skills.test.ts
git commit -m "feat(skills): directory-based skill discovery with SKILL.md convention"
```

---

### Task 2: Remove `skills_dirs` from profile schema and loader

**Files:**
- Modify: `src/profiles/schema.ts`
- Modify: `src/profiles/loader.ts`
- Modify: `tests/profile-loader.test.ts`

- [ ] **Step 1: Read the profile loader test to understand existing coverage**

```bash
cat /Users/pankajkumaryadav/Desktop/development/base/tests/profile-loader.test.ts
```

- [ ] **Step 2: Remove `skills_dirs` from `src/profiles/schema.ts`**

Find and remove this line from `ProfileSchema`:
```typescript
skills_dirs: z.array(z.string()).default([]),
```

The updated object fields after removal should go from `artifact_dir` directly to `tools`:
```typescript
export const ProfileSchema = z.object({
  name: z.string(),
  model: z.object({
    base_url: z.string().url(),
    api_key_env: z.string(),
    id: z.string(),
    fallback_id: z.string().optional(),
  }),
  system_prompt: z.string(),
  working_dir: z.string().default('$CWD'),
  artifact_dir: z.string(),
  tools: z.preprocess(
    (val) => val ?? {},
    z.object({
      builtin: z.preprocess((val) => val ?? {}, BuiltinToolsSchema),
      mcp_servers: z.array(McpServerSchema).default([]),
    })
  ),
  hooks: z.preprocess(
    (val) => val ?? {},
    z.object({
      pre_tool: z.array(z.string()).default([]),
      post_tool: z.array(z.string()).default([]),
      on_stop: z.array(z.string()).default([]),
    })
  ),
  improvement: z.preprocess(
    (val) => val ?? {},
    z.object({
      enabled: z.boolean().default(true),
      model_id: z.string().optional(),
      mine_skills_every_n_sessions: z.number().default(10),
    })
  ),
})
```

- [ ] **Step 3: Remove `skills_dirs` path expansion from `src/profiles/loader.ts`**

Remove this line from the `loadProfile` return:
```typescript
skills_dirs: validated.skills_dirs.map(d => expandPath(d, cwd)),
```

The updated return should be:
```typescript
return {
  ...validated,
  working_dir: expandPath(validated.working_dir, cwd),
  artifact_dir: expandPath(validated.artifact_dir, cwd),
  system_prompt: expandPath(validated.system_prompt, cwd),
}
```

- [ ] **Step 4: Run profile-loader tests**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && npx vitest run tests/profile-loader.test.ts
```

Expected: PASS (or update any assertion that referenced `skills_dirs`).

- [ ] **Step 5: Run full test suite to catch any TypeScript/type errors**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/profiles/schema.ts src/profiles/loader.ts tests/profile-loader.test.ts
git commit -m "feat(profiles): remove skills_dirs — skills auto-discovered from .agents/skills"
```

---

### Task 3: Wire `resolveSkillsDirs` into the server

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update the import in `src/server/index.ts`**

Find the existing import:
```typescript
import { loadAllSkills } from '../skills/loader.js'
```

Replace with:
```typescript
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
```

- [ ] **Step 2: Replace the `loadAllSkills` call in `main()`**

Find:
```typescript
const skills = loadAllSkills(profile.skills_dirs)
```

Replace with:
```typescript
const skills = loadAllSkills(resolveSkillsDirs())
```

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm test
```

Expected: all PASS.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/server/index.ts
git commit -m "feat(server): use resolveSkillsDirs() for auto skill discovery"
```

---

### Task 4: Clean up profile YAML files and CLAUDE.md

**Files:**
- Modify: `profiles/coding.yaml`
- Modify: `profiles/data.yaml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove `skills_dirs` from `profiles/coding.yaml`**

Remove these lines:
```yaml
skills_dirs:
  - ~/.harness/skills
  - ./.harness/skills
```

- [ ] **Step 2: Remove `skills_dirs` from `profiles/data.yaml`**

Remove these lines:
```yaml
skills_dirs:
  - ~/.harness/skills
  - ./.harness/skills
```

- [ ] **Step 3: Update skill section in `CLAUDE.md`**

Find the skills paragraph in CLAUDE.md and replace it with:

```markdown
### Skills

Skills are directories under `.agents/skills/<name>/` containing a `SKILL.md` file with gray-matter frontmatter (`name`, `description`). Optional subdirs: `scripts/`, `references/`, `assets/`.

Four roots are auto-discovered at startup (most-specific wins on name collision):

| Level | Path |
|-------|------|
| User | `~/.agents/skills/` |
| Project | `<git-repo-root>/.agents/skills/` |
| Sub-project | `<CWD>/../.agents/skills/` |
| Folder | `<CWD>/.agents/skills/` |

No profile configuration needed. The `Skill` tool returns `SKILL.md` content; use the `Read` tool for files in subdirectories.
```

- [ ] **Step 4: Run full test suite one final time**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm test
```

Expected: all PASS.

- [ ] **Step 5: Commit and push**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add profiles/coding.yaml profiles/data.yaml CLAUDE.md
git commit -m "chore: remove skills_dirs from profiles, update CLAUDE.md for new skill convention"
git push
```
