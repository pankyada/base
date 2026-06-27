# GitHub Release Distribution Design

**Date:** 2026-06-27
**Status:** Approved

## Overview

Extend the release workflow to publish binaries to GitHub Releases automatically via CI. Add a `scripts/install.sh` that lets anyone install the harness binaries with a single `curl | sh` command.

## Components

### 1. Updated `scripts/release.mjs`

Remove the local binary build step (CI handles it). New flow:

1. Fail fast if working tree has uncommitted tracked changes
2. Bump `package.json` version (patch / minor / major)
3. `git commit -m "chore: release vX.Y.Z"`
4. `git tag vX.Y.Z`
5. `git push origin main`
6. `git push origin vX.Y.Z`

CI triggers on tag push and takes over from there. Local `pnpm build:bin` and `pnpm install:global` remain as separate commands for local dev use.

### 2. `.github/workflows/release.yml`

Triggers on `push` to tags matching `v*`. Runs on `ubuntu-latest` (cheaper than macOS; bun cross-compiles macOS binaries from Linux).

Steps:
1. Checkout repo
2. Install bun
3. `bun install`
4. `pnpm build:bin` — produces all four binaries including `harness-server-linux-x64`
5. `gh release create <tag> bin/harness bin/harness-server bin/harness-server-linux-x64 bin/harness-tui --title "<tag>" --generate-notes`

Requires `GITHUB_TOKEN` (provided automatically by Actions).

### 3. `scripts/install.sh`

One-liner install:
```sh
curl -fsSL https://raw.githubusercontent.com/pankyada/base/main/scripts/install.sh | sh
```

Logic:
- Detect OS (`uname -s`) and arch (`uname -m`)
- Download all three user-facing binaries from latest GitHub release:
  - macOS (arm64 or x64): `harness`, `harness-server`, `harness-tui`
  - Linux x64: `harness-server-linux-x64` (renamed to `harness-server` on install)
- Install to `~/.local/bin`, `chmod +x`
- Print installed version and PATH reminder

Uses GitHub's `releases/latest` redirect — no `gh` CLI or auth required for public repo.

## Out of Scope

- Windows support
- Homebrew tap
- Versioned install (`install.sh v1.2.3`) — latest only
- Signature/checksum verification
