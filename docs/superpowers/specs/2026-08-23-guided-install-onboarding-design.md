# Guided Install & Onboarding — Design (GIO)

> Date: 2026-08-23
> Status: Draft (design)
> Related: `scripts/install.sh`, `src/cli/index.ts`, `src/profiles/registry.ts`,
> `tui/internal/setup/wizard.go`, `docs/DEPLOYMENT.md`, `docs/ROADMAP.md` #13, #30

## Goal

A person who has never seen this repo runs one command, answers a handful of
questions about what they actually want the agent to do, and ends at a working
prompt. On macOS, Linux, **and Windows**. Nothing about "export this env var
first" and nothing that fails on the first message because a key was missing.

The organising question is the one the user asked for: **"what is your primary
use case?"** — coding, data analysis, personal assistant, devops, research. The
answer picks a *default* profile. It does not delete or hide the others.

## What already exists (verified 2026-08-23, do not rebuild)

This section matters more than the rest of the design, because two pieces of
the wizard already ship and one of them is about to be duplicated.

| Piece | State | Where |
|---|---|---|
| Binary installer | Works, macOS + Linux only | [`scripts/install.sh`](../../../scripts/install.sh) |
| Multi-profile directory loading | **Already shipped** — `--profiles <dir>` loads every `*.yaml`, `--default-profile <name>` picks the active one | [`src/profiles/registry.ts:12`](../../../src/profiles/registry.ts), [`src/server/index.ts:88`](../../../src/server/index.ts) |
| Mid-session profile switching | Shipped — `profiles_list` / `set_profile` protocol messages, TUI + web switchers | `src/server/index.ts`, `web/`, `tui/` |
| First-run profile wizard | **Shipped, but TUI-only and narrow** — prompts base URL / API key env var / model ID, writes a hardcoded `coding` profile | [`tui/internal/setup/wizard.go:29`](../../../tui/internal/setup/wizard.go) |
| Server auto-spawn | Shipped — TUI probes `/health` and starts the server itself | [`tui/internal/server/boot.go:81`](../../../tui/internal/server/boot.go) |
| Local client prefs | Shipped, deliberately separate from profile config | [`tui/internal/prefs/prefs.go`](../../../tui/internal/prefs/prefs.go) |
| Docker / compose path | Shipped (#13) | `docker-compose.yml`, `docs/DEPLOYMENT.md` |

**So the "multi-profile with one default" mechanism the request asks for is not
missing — it is unreachable.** `loadProfileDirectory` + `--default-profile`
already do exactly the right thing. Nothing ever calls them with the user's
choice, because nothing ever asks the user and nothing persists an answer.

### The four real gaps

1. **No API key path at all.** Grepping `src/` and `tui/` for `dotenv`,
   `.harness/env`, or any env-file loader returns nothing. Keys come only from
   the ambient process environment. `profiles/coding.yaml` wants
   `OPENAI_API_KEY`, `profiles/assistant.yaml` wants `ANTHROPIC_API_KEY`. A
   fresh install has neither. **This is the actual first-run cliff** — install
   succeeds, first message fails.
2. **No persisted default.** `install.sh` untars all nine profiles into
   `~/.harness/profiles/`, then [`src/server/index.ts:96`](../../../src/server/index.ts)
   hardcodes `~/.harness/profiles/coding.yaml` as the fallback — a *file*, so
   the other eight are not even loaded, and the switcher has nothing to switch
   between. The use-case answer has nowhere to live.
3. **No Windows story.** `install.sh` hard-exits on any non-Darwin/Linux
   `uname`. `build:bin` in `package.json` emits macOS/Linux targets only; the
   Go TUI has no `windows-amd64` target in `scripts/build-tui.mjs`'s sibling
   invocation.
4. **The wizard is in the wrong process.** `tui/internal/setup` can only run
   when the user launches the TUI, asks three low-level questions instead of
   one high-level one, and writes a *new* single `coding` profile that shadows
   the nine shipped ones. Anyone arriving via `harness` (CLI) or the web
   surface gets nothing.

## Non-goals

- **No GUI installer** (`.dmg`, `.msi`, Electron onboarding). The audience is
  terminal users; a windowed installer is a large surface for no reach.
- **No prompting inside `install.sh`.** `curl … | sh` gives the script a pipe
  as stdin; interactive `read` in that position is the classic broken-installer
  bug. All interactivity lives in a Node process the installer *execs* with a
  real TTY.
- **Not a package-manager release** (Homebrew tap, winget manifest, scoop
  bucket) in this pass. Those are downstream of a stable install layout and are
  tracked separately.
- **Not a credential manager.** Keychain / Credential Manager integration is
  sketched in §6 as a later pass, not built here.
- **Not a replacement for Docker.** `docker-compose.yml` stays the deployment
  path; this is the workstation path.

---

## 1. Decision: the installer stays dumb, `harness init` holds the brain

`install.sh` / `install.ps1` do exactly three things — place binaries, ensure
`PATH`, unpack profiles — and then exec `harness init` if (and only if) stdin
is a TTY and `--no-init` was not passed. Everything conditional, interactive,
network-touching, or opinionated lives in `harness init`.

Three reasons this split is load-bearing:

- **CI and re-runs.** The installer must stay idempotent and non-interactive so
  `curl … | sh` in a Dockerfile or a CI step keeps working. Pushing prompts
  into it breaks that permanently.
- **Rerunnability.** Onboarding is not a one-time event. Users change providers,
  rotate keys, and change what they use the agent for. `harness init` is a
  normal command they can run any time; an installer is not.
- **One implementation, three surfaces.** CLI, TUI, and web all need the same
  answer to "which profile is default and where is the key." A Node command is
  callable from all three; a shell fragment is callable from none.

## 2. `harness init` — the flow

New file `src/cli/init.ts`, dispatched from
[`src/cli/index.ts`](../../../src/cli/index.ts) alongside the existing
`stats routing` / `audit` / `server` cases (same `process.argv[2]` pattern,
same "handle then `process.exit`" shape).

```
$ harness init

  1. What will you mostly use this for?
       › coding            — write and refactor code, run tests        (coding)
         data analysis     — read-only SQL and reports                 (data)
         personal assistant— memory, calendar, read-only tools         (assistant)
         devops            — logs, GitHub, scheduled checks            (devops)
         research          — orchestrator + two workers                (research)

  2. Provider for that profile?
       › Anthropic  (api.anthropic.com/v1)
         OpenAI     (api.openai.com/v1)
         Other OpenAI-compatible base URL …

  3. Model?   [claude-sonnet-5]        ← from MODEL_REGISTRY, filtered to provider

  4. API key for ANTHROPIC_API_KEY:  ****        ← masked; skipped if already set

  5. Checking… ✓ key accepted  ✓ model reachable  ✓ port 7337 free

  6. Which surface do you prefer?   › TUI   CLI   Web

  Wrote ~/.harness/config.json  (default profile: coding)
  Wrote ~/.harness/env          (chmod 600)

  Start with:   harness
```

**Step 1 lists the five profiles that map to a use case**, not all nine.
`researcher`, `summariser`, `writer`, and `security` stay installed and
switchable but are not primary-use-case answers — `researcher`/`summariser` are
workers `research.yaml` delegates to, and offering them as a top-level choice
is a category error. The list is derived, not hardcoded: profiles gain an
optional `use_case:` field in `src/profiles/schema.ts` (`{ label, blurb, rank }`),
and init offers exactly the profiles that declare one. A user who writes their
own profile with a `use_case:` block appears in this menu for free.

**Step 4 is skipped when the env var is already set in the parent shell** —
existing users are not re-prompted for a key they already export, and init
never overwrites an ambient value.

**Step 5 is the step that earns the whole feature.** One real request against
the chosen model with a ~5-token cap, so a bad key or a typo'd base URL fails
here, next to the field that caused it, instead of on the user's first real
message. `--offline` skips it.

Flags: `--yes` (accept every default, no prompts — for scripted installs),
`--profile <name>` (skip step 1), `--offline` (skip step 5),
`--reconfigure` (re-ask everything, back up what exists).

## 3. Decision: default ≠ delete

The chosen profile is recorded as a *pointer*, and all nine YAMLs stay on disk
and stay loaded. This is what the user asked for and it is also the cheaper
design, because the machinery exists:

- `~/.harness/profiles/` is passed to the server as a **directory**, so
  [`loadProfileDirectory`](../../../src/profiles/registry.ts) loads all of them.
- `config.json.default_profile` is passed as `--default-profile`, so
  [`selectProfile`](../../../src/profiles/registry.ts) picks the active one.
- The existing `profiles_list` / `set_profile` switcher then works on first run
  instead of showing a single-entry list.

**Change required in `src/server/index.ts:96`:** the no-argument fallback moves
from `~/.harness/profiles/coding.yaml` (a file) to `~/.harness/profiles/` (the
directory), with the default name read from config. The `coding.yaml` literal
stays only as the last resort when neither config nor the directory exists, so
existing installs keep booting.

### `~/.harness/config.json`

```jsonc
{
  "version": 1,
  "default_profile": "coding",   // name, not path — matches selectProfile()
  "profiles_dir": "~/.harness/profiles",
  "surface": "tui",              // tui | cli | web — what `harness` opens
  "initialised_at": "2026-08-23T09:12:44Z",
  "harness_version": "0.7.0"
}
```

Deliberately **not** in this file: themes, approval mode, rail state. Those are
client-local and already owned by
[`tui/internal/prefs`](../../../tui/internal/prefs/prefs.go), which documents
that it is "intentionally independent of server/profile config." That split
holds — `config.json` is machine-level agent config that the server reads;
`tui.json` is per-client UI taste that may be lost harmlessly.

### `resolveDefaultProfile()`

New `src/config/user-config.ts`, one exported resolver with a fixed precedence:

```
--profile / --profiles flag   (explicit invocation wins)
  → $HARNESS_PROFILE           (env override, for CI and per-shell switching)
    → config.json.default_profile
      → 'coding' if present, else first alphabetically   (selectProfile's rule)
```

A missing, malformed, or wrong-`version` `config.json` degrades to the tail of
that chain rather than throwing — the same posture `prefs.Load` already takes.
The server, the CLI, and the TUI all call this one function; the TUI reaches it
through the server's existing `--default-profile` flag rather than parsing JSON
in Go a second time.

## 4. Decision: keys go in `~/.harness/env`, never in a shell rc

`harness init` writes `KEY=value` lines to `~/.harness/env` with mode `0600`,
and the server loads that file at boot — **without overriding anything already
set in `process.env`**, so an explicitly exported key or a CI secret always
wins over the file.

The rejected alternative is appending `export ANTHROPIC_API_KEY=…` to
`~/.zshrc`. It leaks the key into every process the user ever launches, it is
mode `0644` on most systems, it is invisible to `harness doctor`, uninstalling
cannot clean it up, and it does not exist on Windows.

**Honest limitation:** `~/.harness/env` is plaintext at rest. That is the same
posture as the `.env.example` file this repo already ships and the same posture
as `~/.aws/credentials`, and it is stated plainly in the docs rather than
implied to be secure. §6 tracks the OS-keychain upgrade; it is additive because
everything reads through one `loadUserEnv()` seam.

## 5. Decision: `harness doctor` is a separate, always-available command

Step 5 of `init` is a doctor run. Rather than build it twice, `src/cli/doctor.ts`
is the implementation and init calls into it. Checks, each with a one-line fix:

| Check | Failure message points at |
|---|---|
| `config.json` present and parseable | `harness init` |
| Default profile resolves and validates (`loadProfile` + `validateMode`) | the offending YAML path and the Zod error |
| `api_key_env` for the active profile is set (env or `~/.harness/env`) | `harness init --reconfigure` |
| Live model reachability (~5 tokens) | base URL / key |
| Port `HARNESS_PORT` (7337) free, or an existing harness server owns it | `harness server list` / `harness server stop` |
| Binary versions agree (`harness`, `harness-server`, `harness-tui`) | re-run the installer |
| `~/.local/bin` (or `%LOCALAPPDATA%\Programs\harness`) is on `PATH` | the exact export/setx line |

It reuses the shipped process registry
([`src/server/process-registry.ts`](../../../src/server/process-registry.ts),
surfaced today as `harness server list`) for the port check rather than
reimplementing liveness probing.

`doctor` exits non-zero on any failure so it is usable as a CI smoke test, and
takes `--json` for machine consumption.

## 6. Windows

A parallel `scripts/install.ps1`, not a compatibility shim inside `install.sh`.

- `irm https://…/install.ps1 | iex` as the documented one-liner.
- Install dir `%LOCALAPPDATA%\Programs\harness`; `PATH` updated via
  `[Environment]::SetEnvironmentVariable(..., 'User')`.
- `~/.harness` is already portable — Node's `homedir()` and Go's
  `os.UserHomeDir()` both resolve it — but every path built by string
  concatenation with `/` needs an audit pass, and
  [`tui/internal/server/boot.go`](../../../tui/internal/server/boot.go) needs
  `harness-server.exe` in its `serverCommand` fallback.
- **New build targets required.** `package.json`'s `build:bin` has no
  `bun-windows-x64` output and the Go TUI build has no `windows-amd64`. Both
  must land *before* the installer, or it downloads assets that do not exist.
- Windows Defender / SmartScreen will flag unsigned downloaded binaries. Code
  signing is out of scope here; the docs must say so rather than let the user
  hit it blind.

## 7. Consequences for the TUI wizard

[`tui/internal/setup/wizard.go`](../../../tui/internal/setup/wizard.go) stops
writing profiles. On finding no `config.json`, the TUI execs `harness init`
(inheriting the terminal) and re-reads afterwards. `EnsurePromptFile` and the
embedded `assets/coding.md` move to the Node side so there is one copy of the
starter prompt. `--reconfigure` forwards to `harness init --reconfigure`.

The alternative — teaching the Go wizard about use cases, the nine profiles,
key files, and doctor checks — means maintaining the same onboarding logic in
two languages, which is how the two surfaces drift.

**Migration for existing users:** anyone who ran the current TUI wizard has a
hand-written `~/.harness/profiles/coding.yaml`. `init` must detect a profile it
did not write, show the diff, and ask before touching it. Init only rewrites a
profile's `model:` block with explicit confirmation; it never silently edits a
file the user may have customised.

## 8. Test plan

| Area | Test |
|---|---|
| `resolveDefaultProfile` precedence | `tests/user-config.test.ts` — all four levels, plus malformed/missing/wrong-version config degrading rather than throwing |
| Config round-trip | write → read → same object; unknown future fields preserved |
| `init` non-interactive | `--yes --offline` produces a valid `config.json` + `env` in a temp `$HOME`; no prompts, exit 0 |
| `init` prompt flow | injected reader/writer (the pattern `wizard_test.go` already uses), asserting the key is never echoed |
| Env file | mode is `0600`; ambient `process.env` wins over the file; malformed lines skipped, not fatal |
| Use-case menu | derived from `use_case:` fields — adding a profile with one makes it appear; workers without one stay hidden |
| Doctor | each check fails independently with the documented exit code; `--json` shape is stable |
| Server fallback | no-arg boot loads the *directory* and honours `default_profile`; falls back to `coding.yaml` when neither exists |
| Windows paths | path construction unit tests run on `windows-latest` in CI |

Existing suites that must stay green: `tests/profile-registry.test.ts` (which
covers `loadProfileDirectory`), `tui/internal/setup/wizard_test.go` (rewritten,
not deleted — it keeps covering `Reconfigure` and the exec handoff).

## 9. Open questions

1. **Does `harness` with no args launch the TUI?** `config.json.surface` implies
   yes, but today `harness` is the readline CLI and `harness-tui` is separate.
   Making `harness` a launcher that dispatches on `surface` is a better first
   run and a breaking change for anyone scripting `harness`. Leaning: dispatch,
   with `harness cli` as the explicit escape hatch.
2. **Does init offer to write an API key at all, or only tell the user where to
   put one?** Writing it is the better experience and the reason the flow works;
   the counter-argument is that a tool that reads typed secrets is a tool that
   can leak them into logs. Mitigation: masked input, never echoed, never
   logged, never sent to telemetry — and `telemetry/logger.ts` must be checked
   for env capture before this ships.
3. **Anthropic vs OpenAI as the step-2 default.** Six of nine shipped profiles
   are Anthropic; `coding.yaml` — the likely most-picked use case — is OpenAI.
   Defaulting per profile rather than globally is probably right.

## 10. Sequencing

```
1. resolveDefaultProfile() + config.json + server directory fallback   ← unblocks everything
2. loadUserEnv() + ~/.harness/env
3. harness doctor
4. harness init (uses 1–3), install.sh execs it
5. TUI wizard delegates to init
6. Windows build targets → install.ps1
```

Steps 1–4 alone remove the "installed but nothing works" cliff, which is the
actual UX bug. Step 6 is a genuinely new platform and should not be blocked
behind polish on the first five.
