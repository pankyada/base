# GitHub Release Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish harness binaries to GitHub Releases on every `pnpm release`, and provide a `curl | sh` install script.

**Architecture:** `pnpm release` bumps version, commits, tags, and pushes — that push triggers a GitHub Actions workflow which builds binaries and creates a GitHub Release with them as assets. `scripts/install.sh` downloads the correct binary for the user's platform from the latest release.

**Tech Stack:** GitHub Actions, bun (binary compilation), `gh` CLI (release creation in CI), bash (install script).

---

### Task 1: Update `scripts/release.mjs` — replace local build with git push

**Files:**
- Modify: `scripts/release.mjs`

The current script builds binaries locally after tagging. CI now owns the build. Replace the build step with `git push`.

- [ ] **Step 1: Replace build section with push**

Open `scripts/release.mjs`. Replace everything from `// Build binaries` to the end of the file:

```javascript
// Push to GitHub — triggers CI release workflow
console.log('Pushing to GitHub...')
execSync('git push origin main', { stdio: 'inherit' })
execSync(`git push origin v${next}`, { stdio: 'inherit' })
console.log(`Release v${next} triggered. CI will build and publish binaries.`)
console.log(`Track at: https://github.com/pankyada/base/releases/tag/v${next}`)
```

- [ ] **Step 2: Verify script syntax**

```bash
node scripts/release.mjs
```

Expected: `Usage: pnpm release <patch|minor|major>` and exit 1 (no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add scripts/release.mjs
git commit -m "feat: release script pushes to github instead of building locally"
```

---

### Task 2: Create `.github/workflows/release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

Triggers on tag pushes matching `v*`. Uses `ubuntu-latest` — bun cross-compiles the macOS binaries from Linux fine.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build binaries
        run: pnpm build:bin

      - name: Create GitHub Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "${{ github.ref_name }}" \
            bin/harness \
            bin/harness-server \
            bin/harness-server-linux-x64 \
            bin/harness-tui \
            --title "${{ github.ref_name }}" \
            --generate-notes
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add github release workflow on tag push"
```

---

### Task 3: Create `scripts/install.sh`

**Files:**
- Create: `scripts/install.sh`

Downloads the correct binaries from the latest GitHub release and installs to `~/.local/bin`. No `gh` CLI or auth required — uses GitHub's public releases API.

- [ ] **Step 1: Create the install script**

```bash
#!/usr/bin/env sh
set -e

REPO="pankyada/base"
INSTALL_DIR="$HOME/.local/bin"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

OS=$(uname -s)
ARCH=$(uname -m)

case "${OS}" in
  Darwin)
    SERVER_BIN="harness-server"
    ;;
  Linux)
    case "${ARCH}" in
      x86_64)
        SERVER_BIN="harness-server-linux-x64"
        ;;
      *)
        echo "Unsupported Linux architecture: ${ARCH}"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS: ${OS}"
    exit 1
    ;;
esac

mkdir -p "${INSTALL_DIR}"

echo "Installing harness to ${INSTALL_DIR}..."

curl -fsSL "${BASE_URL}/harness" -o "${INSTALL_DIR}/harness"
curl -fsSL "${BASE_URL}/${SERVER_BIN}" -o "${INSTALL_DIR}/harness-server"
curl -fsSL "${BASE_URL}/harness-tui" -o "${INSTALL_DIR}/harness-tui"

chmod +x "${INSTALL_DIR}/harness" "${INSTALL_DIR}/harness-server" "${INSTALL_DIR}/harness-tui"

echo ""
echo "Installed:"
echo "  harness        → ${INSTALL_DIR}/harness"
echo "  harness-server → ${INSTALL_DIR}/harness-server"
echo "  harness-tui    → ${INSTALL_DIR}/harness-tui"
echo ""
echo "Make sure ${INSTALL_DIR} is in your PATH."
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo ""
"${INSTALL_DIR}/harness-server" --version
```

- [ ] **Step 2: Make it executable locally**

```bash
chmod +x scripts/install.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/install.sh
git commit -m "feat: add curl-installable install.sh for harness binaries"
```

---

### Task 4: Push and verify

- [ ] **Step 1: Push main branch**

```bash
git push origin main
```

- [ ] **Step 2: Run a release to trigger CI**

```bash
pnpm release patch
```

Expected output:
```
Bumped version: 0.1.3 → 0.1.4
Tagged: v0.1.4
Pushing to GitHub...
...
Release v0.1.4 triggered. CI will build and publish binaries.
Track at: https://github.com/pankyada/base/releases/tag/v0.1.4
```

- [ ] **Step 3: Verify CI completes**

Open `https://github.com/pankyada/base/actions` and confirm the Release workflow run succeeds. Should take ~2 minutes.

- [ ] **Step 4: Verify GitHub Release assets**

Open `https://github.com/pankyada/base/releases/latest` and confirm four assets are attached:
- `harness`
- `harness-server`
- `harness-server-linux-x64`
- `harness-tui`

- [ ] **Step 5: Test install script end-to-end**

```bash
curl -fsSL https://raw.githubusercontent.com/pankyada/base/main/scripts/install.sh | sh
```

Expected: downloads binaries, installs to `~/.local/bin`, prints version.
