# Binary Release & Version Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pnpm release <patch|minor|major>` command that bumps version, commits, tags, and compiles standalone binaries for macOS and Linux; also add `--version` flag to each binary.

**Architecture:** Three small, independent changes: (1) `--version` flag injected at the top of each entry point before any async work; (2) `build:bin` updated to also emit a `linux-x64` server binary; (3) `scripts/release.mjs` orchestrates version bump → git commit/tag → `pnpm build:bin`.

**Tech Stack:** Bun (compile), Node ESM (`scripts/release.mjs`), semver bumping via string manipulation (no extra deps).

---

### Task 1: Add `--version` to `src/server/index.ts`

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add version check at top of file**

Open `src/server/index.ts`. After the last `import` statement and before the `function writeSessionCount` line, add:

```typescript
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const { version } = _require('../package.json') as { version: string }

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`harness-server ${version}`)
  process.exit(0)
}
```

> **Why `createRequire`?** The project uses `"type": "module"` (ESM). Bun bakes `package.json` into the compiled binary at build time when imported via `createRequire`, so `--version` works in the standalone binary with no file system lookup.

- [ ] **Step 2: Verify manually**

```bash
npx tsx src/server/index.ts --version
```

Expected output: `harness-server 0.1.0`

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add --version flag to harness-server"
```

---

### Task 2: Add `--version` to `src/cli/index.ts`

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add version check at top of file**

Open `src/cli/index.ts`. After the last `import` statement and before the `const PORT` line, add:

```typescript
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const { version } = _require('../package.json') as { version: string }

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`harness ${version}`)
  process.exit(0)
}
```

- [ ] **Step 2: Verify manually**

```bash
npx tsx src/cli/index.ts --version
```

Expected output: `harness 0.1.0`

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add --version flag to harness CLI"
```

---

### Task 3: Add `--version` to `src/tui/index.tsx`

**Files:**
- Modify: `src/tui/index.tsx`

- [ ] **Step 1: Add version check at top of file**

Open `src/tui/index.tsx`. After the last `import` statement and before the `const port` line, add:

```typescript
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const { version } = (_require as any)('../package.json') as { version: string }

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`harness-tui ${version}`)
  process.exit(0)
}
```

> Note: Cast `_require` as `any` to avoid TSX JSX-ambiguity with the generic syntax.

- [ ] **Step 2: Verify manually**

```bash
npx tsx src/tui/index.tsx --version
```

Expected output: `harness-tui 0.1.0`

- [ ] **Step 3: Commit**

```bash
git add src/tui/index.tsx
git commit -m "feat: add --version flag to harness-tui"
```

---

### Task 4: Update `build:bin` to add linux-x64 server binary

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update the `build:bin` script**

Open `package.json`. Replace the `build:bin` value with:

```json
"build:bin": "bun build src/server/index.ts --compile --outfile bin/harness-server --target bun && bun build src/server/index.ts --compile --outfile bin/harness-server-linux-x64 --target bun-linux-x64 && bun build src/cli/index.ts --compile --outfile bin/harness --target bun && bun build src/tui/index.tsx --compile --outfile bin/harness-tui --target bun --external react-devtools-core"
```

- [ ] **Step 2: Run the build and verify all outputs exist**

```bash
pnpm build:bin
ls -lh bin/
```

Expected — all four files present:
```
bin/harness
bin/harness-server
bin/harness-server-linux-x64
bin/harness-tui
```

- [ ] **Step 3: Smoke-test the macOS server binary**

```bash
bin/harness-server --version
```

Expected: `harness-server 0.1.0`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: add linux-x64 server binary target"
```

---

### Task 5: Write `scripts/release.mjs`

**Files:**
- Create: `scripts/release.mjs`
- Modify: `package.json` (add `release` script)

- [ ] **Step 1: Create `scripts/release.mjs`**

```javascript
#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')

const bump = process.argv[2]
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage: pnpm release <patch|minor|major>')
  process.exit(1)
}

// Fail fast if working tree is dirty
const status = execSync('git status --porcelain').toString().trim()
if (status) {
  console.error('Working tree is dirty. Commit or stash changes first.')
  console.error(status)
  process.exit(1)
}

// Read and bump version
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)
const next =
  bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
console.log(`Bumped version: ${pkg.version.replace(next, '')}${next}`)

// Git commit + tag
execSync(`git add package.json`)
execSync(`git commit -m "chore: release v${next}"`)
execSync(`git tag v${next}`)
console.log(`Tagged: v${next}`)

// Build binaries
console.log('Building binaries...')
execSync('pnpm build:bin', { stdio: 'inherit' })
console.log(`Done. Binaries in bin/`)
```

- [ ] **Step 2: Add `release` script to `package.json`**

In `package.json`, inside the `"scripts"` object, add:

```json
"release": "node scripts/release.mjs"
```

- [ ] **Step 3: Test dry-run (read-only check)**

```bash
node scripts/release.mjs
```

Expected: `Usage: pnpm release <patch|minor|major>` and exit 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/release.mjs package.json
git commit -m "feat: add pnpm release script for version bump + binary build"
```

---

### Task 6: End-to-end smoke test

- [ ] **Step 1: Run a patch release**

```bash
pnpm release patch
```

Expected output:
```
Bumped version: 0.1.1
Tagged: v0.1.1
Building binaries...
Done. Binaries in bin/
```

- [ ] **Step 2: Verify git state**

```bash
git log --oneline -3
git tag --sort=-version:refname | head -3
```

Expected: top commit is `chore: release v0.1.1`, tag `v0.1.1` exists.

- [ ] **Step 3: Verify binaries report correct version**

```bash
bin/harness-server --version
bin/harness --version
bin/harness-tui --version
```

Expected:
```
harness-server 0.1.1
harness 0.1.1
harness-tui 0.1.1
```

- [ ] **Step 4: Verify dirty-tree guard**

```bash
echo "dirty" >> package.json
pnpm release patch
git checkout package.json
```

Expected: script exits with `Working tree is dirty.` before making any changes.
