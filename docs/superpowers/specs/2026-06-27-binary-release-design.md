# Binary Release & Version Management Design

**Date:** 2026-06-27
**Status:** Approved

## Overview

Add a release workflow to the harness project: a single `pnpm release <patch|minor|major>` command that bumps the version, commits, tags, and compiles standalone binaries for macOS and Linux. Distribution is local only — no registry or GitHub Releases.

## Components

### 1. Release script (`scripts/release.mjs`)

A standalone ESM script, no new runtime deps. Invoked via `pnpm release patch|minor|major`.

**Steps:**
1. Fail fast if git working tree is dirty (uncommitted changes)
2. Read current version from `package.json`
3. Bump semver field in `package.json` (patch / minor / major)
4. `git add package.json`
5. `git commit -m "chore: release v<new>"`
6. `git tag v<new>`
7. Run `pnpm build:bin` to compile all binaries

### 2. `--version` flag in entry points

Each binary (`server`, `cli`, `tui`) accepts `--version` / `-v` and prints `<name> <version>` then exits. Version is imported directly from `package.json` — bun bakes it into the compiled binary at build time, no runtime file lookup.

```
$ harness-server --version
harness-server 0.1.1
```

### 3. `build:bin` update — add linux-x64 server binary

Only the server binary is compiled for linux-x64 (TUI and CLI are not useful headlessly). Existing macOS binaries unchanged.

New targets:
- `bin/harness-server` — macOS (host)
- `bin/harness-server-linux-x64` — Linux server deploys
- `bin/harness` — macOS CLI (unchanged)
- `bin/harness-tui` — macOS TUI (unchanged)

`bin/` remains git-ignored — binaries are never checked in.

## Out of Scope

- GitHub Releases / binary upload
- Windows binaries
- Changelog generation
- Pre-release tags (alpha/beta/rc)
