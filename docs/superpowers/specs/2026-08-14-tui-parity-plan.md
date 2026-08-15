# Plan: TUI/runtime parity with Claude Code & OpenCode

**Generated**: 2026-08-14
**Estimated Complexity**: High (7 sprints, ~4 of them independent)
**Status**: shipped, then fixed

## Overview

Seven independent workstreams that close the "last mile of the loop" gap against
Claude Code and OpenCode. The harness is ahead on runtime (routing, channels,
temporal memory, delegation, safety, audit); it is behind on the surfaces a user
touches every minute: completing a command, reading a reply, resuming yesterday's
session, knowing the repo's conventions, reaching the web, rehearsing before
acting, and undoing a mistake.

Three findings shaped this plan, all verified against the tree:

1. **`SetCompletionOpen` already exists** ([keys.go:48](../../../tui/internal/ui/keys.go:48))
   and is called only from tests. The tab-to-accept contract was designed and never wired.
2. **Session resume is fully implemented server-side.** `session_list` is handled at
   [project-handlers.ts:20](../../../src/server/project-handlers.ts:20), `resume` at
   [index.ts:640](../../../src/server/index.ts:640), and Go constructors `Resume()` /
   `SessionList()` exist at [msg.go:313](../../../tui/internal/protocol/msg.go:313).
   **Nothing in the UI ever calls them.** Sprint 3 is pure TUI work.
3. **Undo is already end-to-end.** `UndoDescriptor` on `ToolReturn`
   ([types.ts:15](../../../src/tools/types.ts:15)), emitted by `write`/`edit`/`memory-write`/
   `memory-delete`, journalled with the inverse payload
   ([journal.ts:7](../../../src/audit/journal.ts:7)), replayed by
   [`undoAuditEntry`](../../../src/audit/undo.ts:10) behind `harness audit --undo <id>`.
   Sprint 7 is a surface, not a storage layer.

**Explicitly out of scope** (decided 2026-08-14): inline diff rendering for
Edit/Write. `payloadKeys` at [toolarg.go:44](../../../tui/internal/ui/toolarg.go:44)
keeps bulk text out of the transcript and stays as-is.

### Sprint dependency graph

```
S1 completion ──┐
S2 prose/color ─┼── independent, parallelisable
S3 sessions ────┤
S4 AGENTS.md ───┘
S5 web tools ─── independent (touches ACL schema, coordinate with S6)
S6 plan mode ─── depends on nothing, but shares ACL overlay work with S5
S7 undo ──────── independent
```

## Prerequisites

- Go toolchain (TUI), `pnpm` (runtime). No new runtime deps except an optional
  HTML-to-text path in S5 — spec keeps it zero-dep.
- Read [`docs/ADR.md`](../../ADR.md) before S4 and S6: context assembly and
  workflow staging both have recorded rationale that rejects obvious alternatives.
- S5/S6 both edit `BuiltinToolsSchema` and `MODE_DEFAULTS` in
  [profiles/schema.ts](../../../src/profiles/schema.ts:32) — land one, rebase the other.

---

## Sprint 1: Completion popup + skills as commands

**Goal**: One vertical, navigable completion surface serving `/` commands, skills,
and `@` files — replacing the single dim joined line at
[model.go:1939](../../../tui/internal/ui/model.go:1939).

**Demo/Validation**:
- Type `/` → vertical list with `name — description`, ↑/↓ moves, tab/enter accepts, esc dismisses.
- Type `/te` → filters to `/theme`.
- Type `/` → installed skills appear alongside built-in commands, visually distinguished.
- Type `@src/` → same popup shape, file paths.
- `cd tui && go test ./...` green.

### Task 1.1: Completion component
- **Location**: new `tui/internal/ui/completion.go`, new `tui/internal/ui/completion_test.go`
- **Description**: Source-agnostic completion model. No knowledge of where items come from.
  ```go
  type CompletionKind int
  const (CompletionCommand CompletionKind = iota; CompletionSkill; CompletionFile)

  type CompletionItem struct {
      Label  string // "/theme", "@src/main.go", "/code-review"
      Detail string // description column; "" for files
      Insert string // text that replaces the active token
      Kind   CompletionKind
  }

  type Completion struct {
      Open    bool
      Items   []CompletionItem
      Cursor  int
      trigger rune // '/' or '@'
  }

  func (c *Completion) Recompute(value string, commands, skills []CompletionItem, files []string)
  func (c *Completion) Move(delta int)
  func (c Completion) Accept(value string) (newValue string, ok bool) // token-level replace
  func (c Completion) View(width int) string
  ```
  `Recompute` owns trigger detection: reuse the `/`-prefix rule from
  [slash.go:53](../../../tui/internal/ui/slash.go:53) and `activeMentionQuery`
  from [mention.go:38](../../../tui/internal/ui/mention.go:38) — do not duplicate them,
  call them.
- **Dependencies**: none
- **Acceptance Criteria**:
  - Cursor wraps at both ends; `Move` on an empty list is a no-op.
  - `Accept` replaces only the active token, preserving text before it (`fix @a.go and @b` → completing `@b` leaves `@a.go` alone).
  - `View` caps at 8 rows with a `… N more` footer; `Kind` drives the row's color (command=accent, skill=purple, file=dim).
  - Zero items ⇒ `Open == false`.
- **Validation**: table test over `Recompute` inputs; golden-ish assertions on `View` width and row count.

### Task 1.2: Wire into the model
- **Location**: [tui/internal/ui/model.go](../../../tui/internal/ui/model.go)
- **Description**: Add `completion Completion` to the `Model` struct (near `mentionMatches`,
  [model.go:99](../../../tui/internal/ui/model.go:99)). In the key path, **before** the composer
  gets the key: if `m.completion.Open`, route up/down → `Move`, tab/enter → `Accept`, esc → close.
  Call `m.keys.SetCompletionOpen(m.completion.Open)` on every state change — this is the
  existing helper at [keys.go:48](../../../tui/internal/ui/keys.go:48), currently dead.
  Replace the `slashMatches` and `mentionMatches` branches in `View()`
  ([model.go:1939](../../../tui/internal/ui/model.go:1939)) with `m.completion.View(m.width)`.
- **Dependencies**: 1.1
- **Acceptance Criteria**:
  - Tab accepts a completion and does **not** open the panel overlay (`SetCompletionOpen` already flips `Overlay`).
  - Enter with the popup open accepts; enter with it closed still sends the message.
  - Existing `mentionIndexCmd` debounce ([mention.go:20](../../../tui/internal/ui/mention.go:20)) still feeds file items.
- **Validation**: extend `tui/internal/ui/input_superpowers_test.go`; assert `keys_test.go` invariants still hold.

### Task 1.3: Skills as slash commands
- **Location**: [model.go](../../../tui/internal/ui/model.go), [slash.go](../../../tui/internal/ui/slash.go)
- **Description**: `m.installedSkills` ([model.go:90](../../../tui/internal/ui/model.go:90)) is already
  populated from the `skills` server message. Map each to a `CompletionItem{Kind: CompletionSkill}`.
  On dispatch of an unknown `/name`, if it matches an installed skill, send a normal user message:
  `Use the "<name>" skill.` + any trailing args. **No protocol change** — the agent's `Skill` tool
  does the rest.
  **Decided 2026-08-14**: client-side prompt expansion, not a `skill_invoke` protocol message.
  Accepted trade-off — the model *chooses* to call the `Skill` tool, so invocation is
  strongly suggested rather than guaranteed. If that proves unreliable in practice, the
  deterministic path (server forces the tool call) is an additive follow-up that does not
  invalidate this task's UI work.
  Send `skills_list` on connect so the list is warm before the first `/`.
- **Dependencies**: 1.1, 1.2
- **Acceptance Criteria**:
  - `/` lists built-ins first, then skills, each labelled by kind.
  - A skill name colliding with a built-in resolves to the built-in (built-ins win; document it).
  - `/some-skill arg1 arg2` forwards the args into the message.
- **Validation**: app-flow test in `tui/internal/ui/app_test.go` — inject a `skills` message, assert the sent message body.

### Task 1.4: File-backed custom commands
- **Location**: new `src/skills/commands.ts`, [src/types.ts](../../../src/types.ts:144),
  [tui/internal/protocol/msg.go](../../../tui/internal/protocol/msg.go)
- **Description**: Discover `.agents/commands/<name>.md` across the same four levels as skills —
  **reuse the shape of `resolveSkillsDirs`** ([loader.ts:24](../../../src/skills/loader.ts:24)),
  last-write-wins. Frontmatter: `name`, `description`. Body is a prompt template supporting
  `$ARGUMENTS`. Add `ClientMessage {type:'commands_list'}` → `ServerMessage {type:'commands', commands: CommandSummary[]}`.
  TUI expands the template client-side and sends the result as a user message.
- **Dependencies**: 1.1–1.3
- **Acceptance Criteria**:
  - A command file dropped into `.agents/commands/` appears in the popup without a restart-on-first-use caveat documented.
  - `$ARGUMENTS` substitution is literal; a template without it ignores trailing args.
  - Malformed frontmatter is skipped silently, matching `loadSkillsFromDir` behaviour.
- **Validation**: `tests/` vitest for discovery + precedence; Go test for template expansion.

---

## Sprint 2: Prose fold inversion + role colors

**Goal**: The agent's answer is always readable; tool chrome is what collapses.

**Demo/Validation**: ask a question that produces a 6-section markdown reply — the
whole reply renders open. Toggle `/density compact` — it folds. Every turn role is
distinguishable at a glance without reading the label.

### Task 2.1: Default density to `full`
- **Location**: [model.go:180](../../../tui/internal/ui/model.go:180), [prose.go:79](../../../tui/internal/ui/prose.go:79)
- **Description**: Normalize an unset `DensityMode` to `"full"` instead of `"normal"`.
  The fold at [transcript.go:140](../../../tui/internal/ui/transcript.go:140) is already gated on
  `tr.Density != "full"`, so this one-word change stops agent prose collapsing by default.
  Update the `densityModes` detail strings so `full` reads as the default and `normal` no longer claims it.
- **Dependencies**: none
- **Acceptance Criteria**:
  - Fresh prefs ⇒ no prose folding at any section count.
  - `/density normal` and `/density compact` still fold as before.
  - An existing `"normal"` in `~/.harness/tui.json` is respected, not overwritten.
- **Validation**: `transcript_test.go` case asserting a 6-section reply renders every body at default density.

### Task 2.2: Role-colored turn gutter
- **Location**: [transcript.go](../../../tui/internal/ui/transcript.go), [theme.go](../../../tui/internal/ui/theme.go)
- **Description**: Add `roleColor(role string) lipgloss.Color` to theme.go — agent=Accent,
  user=Purple, task=Teal, memory=Info, local=Dim. In `RenderWithHitMap`, wrap each finished
  turn block in a left border painted with that color.
  **Height must not change**: a left border adds a column, not a row. `HitRow` carries only `Y`
  ([transcript.go:45](../../../tui/internal/ui/transcript.go:45)), so hit math is safe — but
  every `lipgloss.Height` accumulation in the loop must still be computed on the *wrapped* block.
- **Dependencies**: none
- **Acceptance Criteria**:
  - Rail click targets and transcript chevron toggles still resolve to the right rows (regression risk is the whole point of this task).
  - Widths: content width shrinks by exactly the gutter, no reflow loop.
  - `mono` theme stays legible when every role collapses to greys.
- **Validation**: extend `layout_test.go` and `transcript_test.go` — assert hit-map `Y` values are unchanged before/after the gutter lands.

### Task 2.3: Prose/chrome contrast pass
- **Location**: [transcript.go:87](../../../tui/internal/ui/transcript.go:87), [section.go](../../../tui/internal/ui/section.go)
- **Description**: Agent header `HARNESS ◆ time` moves from `StDim` to role color + `StFaint` timestamp.
  Confirm tool rows sit at `ColFaint`/`categorySoftColor` and prose at `StText` — the ladder exists,
  it is only the header that competes.
- **Dependencies**: 2.2
- **Acceptance Criteria**: three visual weights, top to bottom — prose > headers > tool chrome.
- **Validation**: screenshot diff by eye; `theme_test.go` guard that no style resolves to the same color as `ColText` for chrome.

---

## Sprint 3: `/sessions` + resume

**Goal**: Reconnect to yesterday's work from inside the TUI. **Server is already done** —
this sprint writes no TypeScript.

**Demo/Validation**: `/sessions` → picker of past sessions with title, date, cost →
enter → transcript context resumes. `harness-tui --continue` resumes the most recent.

### Task 3.1: Session picker state + fetch
- **Location**: [model.go](../../../tui/internal/ui/model.go)
- **Description**: Add `sessionPicker bool`, `sessionCursor int`, `sessionOptions []protocol.SessionSummary`
  mirroring the model-picker fields at [model.go:69](../../../tui/internal/ui/model.go:69).
  `/sessions` sends `protocol.SessionList("")`
  ([msg.go:375](../../../tui/internal/protocol/msg.go:375)); handle the `sessions` server message
  (field already declared, [msg.go:132](../../../tui/internal/protocol/msg.go:132)).
- **Dependencies**: none
- **Acceptance Criteria**: empty list shows an explicit "no past sessions" state, not an empty box.
- **Validation**: `app_test.go` — inject `sessions`, assert picker opens populated.

### Task 3.2: Picker modal + resume dispatch
- **Location**: [modals.go](../../../tui/internal/ui/modals.go), [model.go](../../../tui/internal/ui/model.go), [slash.go](../../../tui/internal/ui/slash.go)
- **Description**: `sessionBody(...)` following the `approvalBody` convention
  ([modals.go:102](../../../tui/internal/ui/modals.go:102)) — columns: relative date, title
  (fall back to `summary`, then id), `$cost`. Enter sends `protocol.Resume(id)`
  ([msg.go:313](../../../tui/internal/protocol/msg.go:313)). Register `sessions` in
  `slashCommands` + `slashOrder` ([slash.go:5](../../../tui/internal/ui/slash.go:5)).
- **Dependencies**: 3.1
- **Acceptance Criteria**:
  - On `session_resumed`, the transcript clears and the status bar shows the resumed id.
  - Resuming mid-run is refused with a notice rather than racing the active loop.
- **Validation**: `model_test.go` — assert the `resume` client message is sent with the selected id.

### Task 3.3: `--continue` flag
- **Location**: [tui/main.go:24](../../../tui/main.go:24)
- **Description**: `--continue` resumes the newest session for the user on connect; `--resume <id>` targets one.
- **Dependencies**: 3.1, 3.2
- **Acceptance Criteria**: no past session ⇒ starts fresh with a notice, never an error exit.
- **Validation**: `server/boot_test.go`-style flag test.

---

## Sprint 4: Project context files (AGENTS.md / CLAUDE.md)

**Goal**: The agent knows the repo's conventions without being told each session.

**Demo/Validation**: drop an `AGENTS.md` with a distinctive rule, start a session, ask
the agent to state the project's conventions — it quotes the file.

### Task 4.1: Discovery + assembly module
- **Location**: new `src/context/project-context.ts`
- **Description**:
  ```ts
  export function resolveContextFiles(cwd?: string): string[]
  export function loadProjectContext(opts?: { maxBytes?: number }): string
  ```
  Four levels, same order and last-write-wins semantics as
  [`resolveSkillsDirs`](../../../src/skills/loader.ts:24) — extract the git-root helper rather
  than copying it. Filenames probed per level: `AGENTS.md`, then `CLAUDE.md`.
  Concatenate under a provenance header naming each file's path. Hard cap (default 32KB)
  with explicit truncation notice in the text.
- **Dependencies**: none
- **Acceptance Criteria**:
  - Missing files ⇒ empty string, never a throw.
  - Cap is enforced per assembled total, and the notice states which file was cut.
  - Symlink escapes outside the resolved roots are ignored.
- **Validation**: vitest with a temp dir tree covering all four levels + precedence.

### Task 4.2: Wire into every system-prompt site
- **Location**: [src/server/index.ts:672](../../../src/server/index.ts:672),
  [src/agents/runner.ts:61](../../../src/agents/runner.ts:61),
  [src/server/run-profile.ts:68](../../../src/server/run-profile.ts:68)
- **Description**: Insert the block between `systemPromptBase` and `skillIndex`.
  **Three call sites — all three must change**, or sub-agents and REST runs silently
  diverge from interactive ones.
- **Dependencies**: 4.1
- **Acceptance Criteria**: identical context text in interactive, delegated, and REST paths (assert in test, not by eye).
- **Validation**: vitest asserting the assembled system message at each of the three entry points.

### Task 4.3: Profile switch
- **Location**: [ContextSchema, profiles/schema.ts:226](../../../src/profiles/schema.ts:226)
- **Description**: `project_files: z.boolean().default(true)`. Off ⇒ current behaviour exactly.
- **Dependencies**: 4.1, 4.2
- **Acceptance Criteria**: default-on does not break the existing profile fixtures.
- **Validation**: schema test + one profile fixture with it disabled.
- **Note — decided 2026-08-14**: project context is `trusted`, the same trust level as the
  profile's own `system_prompt`. Rationale: it is the operator's repo, and tagging it
  `untrusted` would trip provenance gates (roadmap #22) constantly during ordinary work.
  **Accepted risk**: cloning a hostile repo grants its `AGENTS.md` system-prompt authority.
  Mitigations to record in ADR alongside the decision — `context.project_files: false` is the
  kill switch (4.3), and the assembled block keeps its per-file provenance header (4.1) so the
  source of any instruction stays visible in the prompt.

---

## Sprint 5: WebFetch + pluggable WebSearch

**Goal**: The agent can read a URL without an MCP server. Search is an interface with
drivers, inert until a key is configured.

**Demo/Validation**: `WebFetch` a docs page → readable markdown in the transcript.
With `BRAVE_API_KEY` set, `WebSearch` returns ranked results; without it, the tool is
not registered and never advertised to the model.

### Task 5.1: WebFetch tool
- **Location**: new `src/tools/builtin/web-fetch.ts`
- **Description**: Params `{ url: string, max_bytes?: number }`. Zero-dep HTML→text:
  strip `<script>`/`<style>`, unwrap tags, decode entities, collapse whitespace.
  Returns the rich `ToolReturn` form:
  `{ content, provenance: 'untrusted', source: url, effect: 'read' }`
  — [types.ts:16](../../../src/tools/types.ts:16). Provenance is not optional here;
  fetched web text is the canonical untrusted input.
- **Dependencies**: none
- **Acceptance Criteria**:
  - **SSRF guard**: reject non-http(s) schemes, `localhost`, `*.local`, and RFC1918 /
    loopback / link-local / IPv6-ULA literals — check **after** DNS resolution, not just
    on the literal string, and re-check on every redirect hop.
  - Redirect cap (5), total timeout (30s), byte cap (default 2MB) enforced during streaming, not after.
  - Non-HTML content types return a typed stub rather than mangled binary.
- **Validation**: vitest with a local http fixture server covering redirect chains,
  oversized bodies, and each blocked-address class.

### Task 5.2: Search provider interface + Brave driver
- **Location**: new `src/tools/web/provider.ts`, `src/tools/web/brave.ts`, `src/tools/builtin/web-search.ts`
- **Description**:
  ```ts
  export interface SearchResult { title: string; url: string; snippet: string }
  export interface SearchProvider { name: string; search(query: string, limit: number): Promise<SearchResult[]> }
  ```
  Brave first; Tavily/Exa are later drop-ins against the same interface. Key read from
  `process.env[profile.tools.web_search.api_key_env]`, matching how the model API key is
  resolved. Results carry `provenance: 'untrusted'`.
- **Dependencies**: 5.1 (shares the fetch guard)
- **Acceptance Criteria**:
  - No key ⇒ `registerAll` does not register `WebSearch` at all (not registered-and-erroring).
  - Provider errors degrade to a tool error string, never an unhandled rejection.
- **Validation**: vitest with a stub provider; one contract test per driver shape.

### Task 5.3: ACL, effects, modes, registration
- **Location**: [profiles/schema.ts:32](../../../src/profiles/schema.ts:32),
  [src/tools/effects.ts](../../../src/tools/effects.ts),
  [builtin/index.ts:28](../../../src/tools/builtin/index.ts:28)
- **Description**: Add `WebFetch`/`WebSearch` to `BuiltinToolsSchema` (default `prompt`),
  to `EFFECTS` as **`outbound`** (network egress, so `isGatedEffect` catches them), and to all
  four `MODE_DEFAULTS` entries ([schema.ts:116](../../../src/profiles/schema.ts:116)) —
  `allow` for developer/analyst, `deny` for production. Register in `registerAll`.
- **Dependencies**: 5.1, 5.2
- **Acceptance Criteria**: `analyst` mode can fetch but not write; `production` cannot fetch.
- **Validation**: extend the existing ACL/mode test matrix.

---

## Sprint 6: Plan mode via workflow stages

**Goal**: Rehearse before acting, reusing `src/workflow/` rather than adding a fifth approval mode.

**Gap this closes**: workflow stages exist but **there is no per-stage tool gating** —
`runner.ts` runs each stage against the profile-wide ACL. A `plan` stage can currently
write files, which makes it useless as a rehearsal.

**Demo/Validation**: `/plan refactor the auth module` → recon+plan stages run read-only,
plan artifact renders, prompt offers proceed / edit / cancel → proceed runs the normal
loop with the plan in context.

### Task 6.1: Per-stage ACL overlay
- **Location**: new `src/workflow/stage-acl.ts`, [src/tools/acl.ts:150](../../../src/tools/acl.ts:150)
- **Description**: `stageAcl(stage: Stage): Partial<Record<string, AclValue>>` — `recon`/`plan`/`design`
  deny `Write`, `Edit`, `Bash`, `ExecuteCode`, `Delegate`, `MemoryDelete`, and (post-S5) `WebSearch`
  stays allowed while writes do not. `build`/`verify`/`review` return `{}` (profile governs).
  Add an optional overlay parameter to `resolveAcl`, consulted **before** mode defaults so a
  read-only stage cannot be widened by `yolo`.
- **Dependencies**: none (coordinate with 5.3 on the same schema file)
- **Acceptance Criteria**:
  - `yolo` + `plan` stage ⇒ writes still denied. This is the whole security property; test it explicitly.
  - No behaviour change when `workflow.enabled` is false.
- **Validation**: unit tests over the `resolveAcl` matrix — every (stage × mode) pair.

### Task 6.2: Interactive plan entry
- **Location**: [src/server/index.ts](../../../src/server/index.ts), [src/workflow/runner.ts](../../../src/workflow/runner.ts), [src/types.ts:144](../../../src/types.ts:144)
- **Description**: `ClientMessage {type:'plan_request'; content: string}`. Server runs triage +
  the `plan` stage only, with the 6.1 overlay applied, streaming stage events through the existing
  `stage` message (TUI strip already consumes it, [model.go:1760](../../../tui/internal/ui/model.go:1760)).
  The artifact already lands at `<artifact_dir>/workflow/<session>/plan.md`
  ([artifacts.ts:19](../../../src/workflow/artifacts.ts:19)). On completion, reuse
  `input_request` (kind `select`, options proceed/edit/cancel) — no new approval primitive.
- **Dependencies**: 6.1
- **Acceptance Criteria**:
  - Works with `workflow.enabled: false` — plan mode forces staging for that one turn only and does not persist the flag.
  - Cancel leaves no partial artifact and no session mutation.
  - Proceed injects the plan body as context for the follow-on run.
- **Validation**: vitest driving `plan_request` end to end with a stubbed loop.

### Task 6.3: TUI plan surface
- **Location**: [slash.go](../../../tui/internal/ui/slash.go), [model.go](../../../tui/internal/ui/model.go)
- **Description**: `/plan <request>`; render the artifact as a distinct turn role (`plan`,
  reusing the S2 gutter colors); wire the select prompt to the existing input modal.
- **Dependencies**: 6.2, 2.2
- **Acceptance Criteria**: plan turns are visually distinct from agent turns and never fold.
- **Validation**: `app_test.go` flow — plan_request → stage events → artifact → select → proceed.

---

## Sprint 7: `/undo` — surface the existing audit journal

**Goal**: Expose shipped undo plumbing in the TUI. **No new storage format.**

**Demo/Validation**: agent edits three files → `/undo` lists the three reversible actions
newest-first → enter restores one → notice confirms the path.

### Task 7.1: Undo list + apply handlers
- **Location**: new `src/server/undo-handlers.ts` (mirroring [project-handlers.ts](../../../src/server/project-handlers.ts)), [src/types.ts:144](../../../src/types.ts:144)
- **Description**: `undo_list` → read the journal via
  [`src/audit/query.ts`](../../../src/audit/query.ts:21), filter to the current
  `session_id` where `undo != null && ok`, newest first, cap 50 → `{type:'undo_entries', entries}`.
  `undo_apply {id}` → [`undoAuditEntry`](../../../src/audit/undo.ts:10) → notice with its return string.
- **Dependencies**: none
- **Acceptance Criteria**:
  - Entries scoped to the **current session and user** — never another user's journal.
  - Expired entries (`expires_at`) are listed but marked unavailable, not hidden (the user should see why).
  - Already-applied entries are marked so, so double-apply is visible rather than silent.
- **Validation**: vitest over a temp journal fixture covering expiry, cross-session, cross-user.

### Task 7.2: Staleness guard
- **Location**: [src/audit/undo.ts](../../../src/audit/undo.ts:14)
- **Description**: `file_restore` currently overwrites unconditionally. Record a hash of the
  post-write content at journal time; on undo, if the on-disk file no longer matches, refuse and
  report drift instead of clobbering newer work.
  This is an **additive** field on the `undo.payload` object — journal lines are JSONL and
  already tolerate unknown keys, so old entries simply lack it.
- **Dependencies**: 7.1
- **Acceptance Criteria**:
  - Hand-edited-since files are refused with a clear message; unchanged files restore normally.
  - Entries written before this task (no hash) fall back to the current unconditional behaviour
    with a "cannot verify" warning in the result string — never a hard refusal that would
    strand already-journalled undos.
- **Validation**: vitest — write, modify externally, attempt undo, assert refusal and that content is untouched.

### Task 7.3: TUI undo panel
- **Location**: new `tui/internal/ui/undo.go`, [slash.go](../../../tui/internal/ui/slash.go)
- **Description**: `/undo` opens a list panel modelled on the pending inbox
  ([inbox.go](../../../tui/internal/ui/inbox.go)) — tool, target, age, availability.
  Enter applies; result lands as a notice.
- **Dependencies**: 7.1
- **Acceptance Criteria**: empty state reads "nothing to undo in this session"; unavailable rows are not selectable.
- **Validation**: `app_test.go` flow test.

---

## Testing Strategy

| Layer | Command | Applies to |
|---|---|---|
| Go unit + app-flow | `cd tui && go test ./...` | S1, S2, S3, S6.3, S7.3 |
| Vitest | `pnpm test` | S4, S5, S6.1–6.2, S7.1–7.2 |
| Types | `pnpm typecheck` | every runtime sprint |
| Manual | `pnpm dev` + `pnpm dev:tui` | each sprint's demo checklist |

Per-sprint gate: the demo checklist passes **and** the full suite is green before the
next sprint starts. S2 additionally requires the hit-map regression assertions from 2.2.

## Potential Risks & Gotchas

1. **S2 hit-map drift (highest risk in the plan).** The transcript's click targets are
   computed in the same pass that renders ([transcript.go:56](../../../tui/internal/ui/transcript.go:56)).
   A gutter that changes block height by even one row silently misaligns every chevron below it.
   Mitigation: assert hit-map `Y` equality before/after in tests, not by clicking around.
2. **S1 key precedence.** Tab is bound to both `Overlay` and `AcceptCompletion`;
   `SetCompletionOpen` resolves it, but only if it is called on *every* transition — including
   composer clears, sends, and esc. A missed call strands tab.
3. **S4 three call sites.** Missing `agents/runner.ts` or `run-profile.ts` produces the
   worst failure mode here: sub-agents that behave subtly differently from the main loop.
   Assert all three in one test.
4. **S5 SSRF via redirect.** Validating only the initial URL is the classic hole — a public
   URL can 302 to `169.254.169.254`. Re-validate post-DNS on every hop.
5. **S5/S6 schema collision.** Both edit `BuiltinToolsSchema` / `MODE_DEFAULTS`. Land sequentially.
6. **S6 overlay vs yolo.** If the overlay is consulted after mode defaults, `yolo` re-opens
   writes during a plan stage and the feature is worthless. Order is the spec.
7. **S7 clobbering.** Without 7.2, `/undo` can destroy work written after the journalled edit.
   7.2 is not optional polish — treat it as part of 7.1's definition of done.
8. **Prefs polarity (already shipped).** `rail_hidden` inverted-bool landed on
   2026-08-14; if S2 adds prefs fields, follow that convention — zero value = the on state.

## Rollback Plan

Each sprint is one branch, independently revertable:

- **S1/S2/S3/S6.3/S7.3** — TUI-only; revert the Go commits, rebuild `pnpm build:bin`. No data migration.
- **S4** — set `context.project_files: false` in the profile for an instant kill switch without a deploy.
- **S5** — remove the two `registerTool` calls; ACL entries are `.passthrough()`-tolerant and can linger harmlessly.
- **S6** — `resolveAcl`'s overlay parameter is optional; passing nothing restores prior behaviour exactly.
- **S7** — read-only until 7.2 lands; `undo_apply` can be feature-flagged off server-side while the list stays.

No sprint changes an on-disk format **incompatibly**. Two shapes gain fields, both additive
and both readable by the prior code: the audit journal's `undo.payload` hash (7.2), and any
new prefs keys (zero value must mean the on state, per the `rail_visible` → `rail_hidden`
convention that shipped 2026-08-14 and degrades to "rail visible" for old files).
