# Plan: guided install & first-run onboarding (#30)

**Generated**: 2026-08-23
**Estimated Complexity**: Medium (6 sprints; S1–S4 are the value, S6 is a new platform)
**Status**: not started

## Overview

A fresh install today places binaries and stops. There is no API key path, no
persisted "which profile is default," and no Windows support — so the first
message fails on a missing `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.

Full rationale for every decision below is in
[`docs/superpowers/specs/2026-08-23-guided-install-onboarding-design.md`](../specs/2026-08-23-guided-install-onboarding-design.md).
**Read it before starting.** This file is the task breakdown; that file is the
"why", and it records which alternatives were rejected and for what reason.

The single most important thing to understand before writing code: **the
multi-profile-with-one-default mechanism already exists and is merely
unreachable.** `loadProfileDirectory(dir, defaultName)`
([`src/profiles/registry.ts:12`](../../../src/profiles/registry.ts)) and the
`--profiles` / `--default-profile` flags
([`src/server/index.ts:88`](../../../src/server/index.ts)) already do exactly
the right thing. Nothing calls them with a user's choice because nothing asks
the user and nothing persists an answer. Do not build a second profile-
selection mechanism.

Likewise, a first-run wizard already ships — in Go, in the TUI only, asking the
wrong questions: [`tui/internal/setup/wizard.go:29`](../../../tui/internal/setup/wizard.go).
S5 replaces it with a delegation. Do not extend it in place.

### Sprint dependency graph

```
S1 config.json + resolveDefaultProfile + server directory fallback
  ↓  (everything reads through this)
S2 ~/.harness/env + loadUserEnv                    ← independent of S1, can run in parallel
  ↓
S3 harness doctor            (needs S1 + S2)
  ↓
S4 harness init              (needs S1 + S2 + S3; install.sh execs it)
  ↓
S5 TUI wizard delegates to init   (needs S4)

S6 Windows build targets → install.ps1   ← independent of S1–S5, but its build
                                            targets must land before install.ps1
```

S1 and S2 are genuinely parallel. S3–S5 are a chain. S6 is its own track and
should not be blocked behind polish on the first five.

## Prerequisites

- Read the design doc in full (linked above).
- Read `docs/ROADMAP.md` #30 for the acceptance bullets this closes, and #13
  ("Simplified deployment") for what already shipped in that space.
- Read `docs/ADR.md` conventions — S1, S2, and S5 each need an ADR entry
  (next free number is **ADR-75**).
- **Baseline, measured 2026-08-23 — confirm before starting:**
  - `pnpm typecheck` — clean
  - `pnpm test` — **712 passed / 117 files**
  - `cd tui && go test ./...` — all packages ok
  - If any of these are red, something changed since 2026-08-23. Investigate
    rather than working around it.
- Commit each sprint separately. Do not squash S1–S6 into one commit.

---

## Sprint 1: config.json + `resolveDefaultProfile()` + directory fallback

**Goal**: a persisted default profile that the server honours, with all nine
profiles loaded and switchable — so the shipped `set_profile` switcher has
something to switch between on a fresh install.

**Demo/Validation**: with `~/.harness/config.json` naming `data` as default and
nine YAMLs in `~/.harness/profiles/`, `harness-server` with no arguments boots
on `data`, and `profiles_list` returns all nine.

### Task 1.1: `src/config/user-config.ts`

- **Location**: `src/config/user-config.ts` (new)
- **Description**: define the `UserConfig` type and `readUserConfig()` /
  `writeUserConfig()` over `~/.harness/config.json`. Shape is in design §3.
  Fields: `version` (literal `1`), `default_profile` (a **name**, matching
  `selectProfile`'s contract — not a path), `profiles_dir`, `surface`,
  `initialised_at`, `harness_version`.
  Unknown fields must round-trip unchanged so a newer harness writing extra
  keys is not destroyed by an older one. Missing, malformed, or wrong-`version`
  files return `undefined` rather than throwing — mirror the posture
  [`tui/internal/prefs/prefs.go`](../../../tui/internal/prefs/prefs.go) already
  documents for a lost prefs file.
- **Dependencies**: none
- **Acceptance Criteria**: round-trip test passes; a file containing `{`
  returns `undefined` and does not throw.

### Task 1.2: `resolveDefaultProfile()`

- **Location**: `src/config/user-config.ts`
- **Description**: one exported resolver with the precedence fixed in design §3:
  explicit `--profile`/`--profiles` flag → `$HARNESS_PROFILE` →
  `config.json.default_profile` → `selectProfile`'s existing rule (`coding`,
  else first alphabetically). Takes its inputs as arguments (flag value, env,
  home dir) so it is testable without touching the real `$HOME`.
- **Dependencies**: 1.1
- **Acceptance Criteria**: `tests/user-config.test.ts` covers all four levels
  plus each degradation path.

### Task 1.3: server no-arg fallback loads the directory

- **Location**: [`src/server/index.ts:87-100`](../../../src/server/index.ts)
- **Description**: today the no-argument fallback is
  `resolve(homedir(), '.harness', 'profiles', 'coding.yaml')` — a **file**, so
  only one of nine profiles loads. Change it to the profiles **directory**,
  with the default name from `resolveDefaultProfile()`. Keep the existing
  explicit-flag paths untouched. Keep `coding.yaml` as a last-resort fallback
  when neither config nor the directory exists, so current installs keep
  booting. The existing `[profiles] no --default-profile supplied` warning
  should not fire when config supplied one.
- **Dependencies**: 1.2
- **Acceptance Criteria**: temp-`$HOME` test — nine YAMLs + config naming
  `data` boots on `data` with `profiles.size === 9`; no config falls back to
  `coding`; neither present still loads a lone `coding.yaml`.

### Task 1.4: ADR-75

- **Location**: `docs/ADR.md`
- **Description**: record *default means pointer, not prune* — why all profiles
  stay loaded, why `default_profile` is a name not a path, and why client UI
  taste stays in `tui.json` rather than moving into `config.json`.
- **Dependencies**: 1.3
- **Acceptance Criteria**: entry follows the existing
  Context / Decision / Consequences format.

---

## Sprint 2: `~/.harness/env` + `loadUserEnv()`

**Goal**: the harness can find an API key that was never exported into the
shell.

**Demo/Validation**: with `ANTHROPIC_API_KEY` absent from the environment but
present in `~/.harness/env`, the server boots and completes a request.

### Task 2.1: `loadUserEnv()`

- **Location**: `src/config/user-env.ts` (new)
- **Description**: parse `KEY=value` lines from `~/.harness/env`. Skip blank
  lines and `#` comments; a malformed line is skipped with a warning, never
  fatal. **Never overwrite a key already present in `process.env`** — an
  explicit export or a CI secret always wins. Strip surrounding quotes. Do not
  add a `dotenv` dependency for ~30 lines of parsing. Also export
  `writeUserEnv()` which creates the file with mode `0600` and preserves other
  keys when updating one.
- **Dependencies**: none
- **Acceptance Criteria**: `tests/user-env.test.ts` — ambient wins; malformed
  line skipped not fatal; written file is mode `0600`; updating one key
  preserves the rest.

### Task 2.2: load it at server boot

- **Location**: [`src/server/index.ts`](../../../src/server/index.ts), before
  any profile use
- **Description**: call `loadUserEnv()` early enough that
  `process.env[profile.model.api_key_env]` resolves for a key that lives only
  in the file. Note this is a real ordering constraint, not a stylistic one.
- **Dependencies**: 2.1
- **Acceptance Criteria**: integration test with a temp `$HOME` — key only in
  the file, session starts.

### Task 2.3: audit telemetry for env capture

- **Location**: [`src/telemetry/logger.ts`](../../../src/telemetry/logger.ts)
- **Description**: before anything writes secrets to a file this repo manages,
  confirm nothing logs `process.env` wholesale into
  `~/.harness/telemetry.jsonl`, and confirm the same for the audit path. This
  is a **gate on Sprint 4**, not a nice-to-have: design §9 flags it as the
  open question that decides whether `init` may accept a typed key at all. If
  something does capture env, fix it here and say so explicitly.
- **Dependencies**: none
- **Acceptance Criteria**: written finding either way — "audited, nothing
  captures env" or the fix. Do not skip this and do not report it as clean
  without having looked.

### Task 2.4: ADR-76

- **Location**: `docs/ADR.md`
- **Description**: record *keys live in `~/.harness/env`, never in a shell rc* —
  including the honest limitation that the file is plaintext at rest, the
  comparison to `~/.aws/credentials`, and the `loadUserEnv()` seam that makes
  an OS-keychain backend additive later.
- **Dependencies**: 2.1
- **Acceptance Criteria**: the plaintext limitation is stated plainly, not
  implied away.

---

## Sprint 3: `harness doctor`

**Goal**: every first-run failure mode reports itself with the command that
fixes it, in one place, runnable any time.

**Demo/Validation**: with a deliberately wrong API key, `harness doctor` fails
the reachability check, names the profile and env var, exits non-zero.

### Task 3.1: the check set

- **Location**: `src/cli/doctor.ts` (new), dispatched from
  [`src/cli/index.ts`](../../../src/cli/index.ts) using the same
  `process.argv[2] === 'audit'` / `'server'` pattern already there
- **Description**: implement the seven checks tabulated in design §5. Each
  returns `{ name, ok, detail, fix }` — the `fix` string is the literal command
  the user should run. For the port check, reuse
  [`src/server/process-registry.ts`](../../../src/server/process-registry.ts)
  (already surfaced as `harness server list`); do not reimplement liveness
  probing. Live model reachability is one request capped at ~5 tokens.
- **Dependencies**: S1, S2
- **Acceptance Criteria**: each check fails independently in a unit test with
  an injected environment.

### Task 3.2: output, exit codes, `--json`

- **Location**: `src/cli/doctor.ts`
- **Description**: human output is a checklist with the failing `fix` lines
  called out. Non-zero exit on any failure so it works as a CI smoke test.
  `--json` emits a stable machine shape. `--offline` skips the network check.
  Export the runner so Sprint 4 calls it directly rather than shelling out.
- **Dependencies**: 3.1
- **Acceptance Criteria**: `tests/doctor.test.ts` asserts the `--json` shape
  and the exit codes.

---

## Sprint 4: `harness init`

**Goal**: the flow the whole feature exists for — one question about the user's
actual use case, then a working install.

**Demo/Validation**: on a clean temp `$HOME` with no keys exported, `harness
init` walks the six steps in design §2 and ends with a config, an env file, and
a passing doctor run.

**Gate**: do not start until Task 2.3's telemetry audit is done and clean.

### Task 4.1: `use_case:` field in the profile schema

- **Location**: [`src/profiles/schema.ts:258`](../../../src/profiles/schema.ts)
  (`ProfileSchema`), plus the five profiles in `profiles/`
- **Description**: add an optional `use_case: { label, blurb, rank }` block.
  Add it to `coding`, `data`, `assistant`, `devops`, and `research` **only** —
  `researcher` and `summariser` are workers `research.yaml` delegates to, and
  `writer` / `security` are pattern demos; none belong in a top-level
  use-case menu. They stay installed and switchable.
- **Dependencies**: none
- **Acceptance Criteria**: `tests/profile-schema.test.ts` covers the new field;
  `tests/example-profiles.test.ts` still passes; a profile without `use_case`
  still validates.

### Task 4.2: the wizard

- **Location**: `src/cli/init.ts` (new)
- **Description**: the six steps in design §2. Step 1's menu is **derived** by
  loading the profiles directory and keeping those that declare `use_case`,
  sorted by `rank` — not hardcoded, so a user's own profile appears for free.
  Step 2's provider default comes from the chosen profile's existing
  `model.base_url`, not a global default (design §9.3). Step 3 filters
  `MODEL_REGISTRY` ([`src/models/registry.ts`](../../../src/models/registry.ts))
  by provider. Step 4 is **skipped entirely when the env var is already set**
  in the parent shell, and input is masked, never echoed, never logged. Step 5
  calls Sprint 3's runner.
- **Dependencies**: 4.1, S3
- **Acceptance Criteria**: prompt-flow test with an injected reader/writer —
  the same pattern
  [`tui/internal/setup/wizard_test.go`](../../../tui/internal/setup/wizard_test.go)
  already uses — asserting the key never appears in written output.

### Task 4.3: flags and the existing-profile guard

- **Location**: `src/cli/init.ts`
- **Description**: `--yes` (all defaults, no prompts), `--profile <name>`
  (skip step 1), `--offline` (skip step 5), `--reconfigure` (re-ask, back up
  what exists). **The guard matters**: anyone who ran the current Go wizard has
  a hand-written `~/.harness/profiles/coding.yaml`. If init would modify a
  profile it did not write, show the diff and ask first. Init only rewrites a
  profile's `model:` block with explicit confirmation — never silently.
- **Dependencies**: 4.2
- **Acceptance Criteria**: `--yes --offline` on a clean temp `$HOME` produces a
  valid config + env, no prompts, exit 0. A pre-existing customised profile is
  not modified without confirmation.

### Task 4.4: installer execs init

- **Location**: [`scripts/install.sh`](../../../scripts/install.sh)
- **Description**: at the end, exec `harness init` **only** when stdin is a TTY
  (`[ -t 0 ]`) and `--no-init` was not passed. Do not add prompts to the shell
  script itself — `curl … | sh` hands it a pipe as stdin and interactive `read`
  there is the classic broken-installer bug (design §"Non-goals").
- **Dependencies**: 4.3
- **Acceptance Criteria**: `curl`-style piped invocation still completes
  non-interactively; a TTY invocation reaches the wizard.

### Task 4.5: docs

- **Location**: `README.md`, `docs/DEPLOYMENT.md`
- **Description**: replace the "export your key first" instructions with the
  init flow. State the plaintext-at-rest limitation of `~/.harness/env`
  plainly. Document `harness doctor` as the thing to run when something is off.
- **Dependencies**: 4.4
- **Acceptance Criteria**: no remaining doc path tells a new user to export a
  key by hand as the primary route.

---

## Sprint 5: the TUI wizard delegates

**Goal**: one onboarding implementation, not two in two languages.

**Demo/Validation**: `harness-tui` on a clean `$HOME` runs the Node wizard
inline, then boots against the profile it chose.

### Task 5.1: replace `EnsureProfile` with a delegation

- **Location**: [`tui/internal/setup/wizard.go`](../../../tui/internal/setup/wizard.go)
- **Description**: on finding no `~/.harness/config.json`, exec `harness init`
  with the terminal inherited, then re-read. Delete the profile-writing path
  (`renderProfile`, `yamlQuote`, the hardcoded `coding` YAML). Keep
  `Reconfigure` but have `--reconfigure` forward to `harness init
  --reconfigure`. Move `EnsurePromptFile` and the embedded
  `assets/coding.md` to the Node side so one copy of the starter prompt exists.
- **Dependencies**: S4
- **Acceptance Criteria**: `wizard_test.go` rewritten (**not deleted**) —
  it keeps covering `Reconfigure` and now covers the exec handoff with a stub
  binary. `cd tui && go test ./...` green.

### Task 5.2: ADR-77

- **Location**: `docs/ADR.md`
- **Description**: record *onboarding lives in one process* — why the Go wizard
  became a delegation rather than growing use-case knowledge, and the drift
  argument for not maintaining the same flow twice.
- **Dependencies**: 5.1
- **Acceptance Criteria**: entry explains what a future contributor tempted to
  re-add a native Go wizard should weigh.

---

## Sprint 6: Windows

**Goal**: a Windows user can install and run. Independent of S1–S5.

**Demo/Validation**: on `windows-latest` CI, the PowerShell installer places
binaries, `harness doctor --offline` exits 0.

**Order matters inside this sprint**: build targets first. An installer that
downloads release assets which do not exist is worse than no installer.

### Task 6.1: Windows build targets

- **Location**: [`package.json`](../../../package.json) `build:bin`,
  [`scripts/build-tui.mjs:10`](../../../scripts/build-tui.mjs),
  `scripts/release.mjs`
- **Description**: add `bun-windows-x64` outputs for server and CLI, add
  `['windows', 'amd64', 'windows-amd64']` to the `build-tui.mjs` target list
  (with a `.exe` suffix), and add the new assets to the release upload list.
- **Dependencies**: none
- **Acceptance Criteria**: `pnpm build:bin` emits Windows binaries; release
  script lists them.

### Task 6.2: path portability audit

- **Location**: `src/`, `tui/`
- **Description**: `~/.harness` resolves fine via `homedir()` /
  `os.UserHomeDir()`, but every path built by string-concatenating `/` needs
  checking. Specifically
  [`tui/internal/server/boot.go`](../../../tui/internal/server/boot.go)'s
  `serverCommand` must find `harness-server.exe`.
- **Dependencies**: none
- **Acceptance Criteria**: path-construction unit tests run on
  `windows-latest` in CI.

### Task 6.3: `install.ps1`

- **Location**: `scripts/install.ps1` (new)
- **Description**: mirror `install.sh`. Install dir
  `%LOCALAPPDATA%\Programs\harness`; `PATH` via
  `[Environment]::SetEnvironmentVariable(..., 'User')`; exec `harness init` at
  the end under the same TTY condition. Document
  `irm https://…/install.ps1 | iex` as the one-liner.
- **Dependencies**: 6.1, 6.2
- **Acceptance Criteria**: runs clean on `windows-latest`; `harness doctor
  --offline` exits 0 afterwards.

### Task 6.4: say the unsigned-binary thing out loud

- **Location**: `README.md`, `docs/DEPLOYMENT.md`
- **Description**: Windows Defender / SmartScreen will flag unsigned downloaded
  binaries. Code signing is out of scope. Document the warning and what it
  means rather than letting a new user hit it blind.
- **Dependencies**: 6.3
- **Acceptance Criteria**: the limitation is documented, not glossed.

---

## Definition of done

- `pnpm typecheck` clean; `pnpm test` ≥ 712 passing with new tests added;
  `cd tui && go test ./...` green; `scripts/check-boundary.sh` passes.
- A clean temp `$HOME` with no exported keys goes from `install.sh` to a
  completed agent turn with no hand-editing of any file.
- All nine profiles remain installed and switchable; the default is a pointer.
- ADR-75, ADR-76, ADR-77 written.
- `docs/ROADMAP.md` #30 flipped to ✅ with a "What shipped" list.

## Notes for whoever implements this

- **S1 Task 1.3 is a behaviour change to a boot path.** Existing installs must
  keep working; that is what the `coding.yaml` last-resort fallback is for.
- **Task 2.3 gates Sprint 4.** Do not write a secrets file before confirming
  nothing in telemetry or audit captures the environment.
- If the design doc and this plan disagree, the design doc wins — and say so
  rather than silently following one.
- Design §9 lists three questions that were deliberately **not** decided:
  whether bare `harness` dispatches on `config.surface` (a breaking change for
  anyone scripting `harness`), whether init should accept a typed key at all,
  and the provider default. Do not decide #1 unilaterally; surface it.
