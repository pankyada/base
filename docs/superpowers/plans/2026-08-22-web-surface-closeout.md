# Plan: close the last 3 gaps in the web surface track (#25–#29)

**Generated**: 2026-08-22
**Estimated Complexity**: Small–Medium (3 sprints, independent, none security-critical
but G1 guards a security-relevant boundary)
**Status**: complete — G1, G2, and G3 implemented and committed separately

## Overview

#25–#29 are committed (`71b7a8a`…`143e8c0`, 5 commits ahead of `origin/main`).
Independent verification on 2026-08-22 confirmed the track is substantially
correct, including all 8 findings from the prior fixes pass — with three
exceptions, one carried over (F7's CI wiring) and two newly found while
checking #29's "To build" list line by line. Full rationale for each is in
`docs/superpowers/specs/2026-08-22-web-surface-closeout-design.md` — read it
before starting; this plan is the task breakdown, that doc is the "why".

None of these are new subsystems. G1 and G3 wire up mechanisms that already
work correctly but aren't connected to anything automated. G2 needs one small,
genuinely new server capability — say so plainly when you get to it, don't
treat it as a copy of an existing pattern.

### Sprint dependency graph

```
S1 escape corpus CI wiring (G1) ──────────────── independent, do first (guards a security boundary)
S2 always-allow (G2) ──────────────────────────── independent, touches src/types.ts
S3 budget-exceeded live wiring (G3) ────────────── independent, touches src/types.ts
```

S2 and S3 both touch `src/types.ts` and require a `web/lib/protocol.ts`
regeneration — land them as separate commits regardless, but expect a trivial
rebase conflict in that one generated file if done out of order. All three
sprints can run in parallel; none blocks another.

## Prerequisites

- Read `docs/superpowers/specs/2026-08-22-web-surface-closeout-design.md` in
  full before starting any sprint.
- Read `docs/superpowers/specs/2026-08-16-web-surface-fixes-design.md` for
  F7's original context (G1 is its continuation) and F1's ACL-depth test
  pattern (G2 reuses that shape).
- Read `docs/ROADMAP.md`'s "Track: web surface (#25–#29)" section for the
  acceptance bullets this plan closes out.
- Confirm baseline before starting: `pnpm typecheck` clean, `pnpm test`
  673/673, `cd web && npx vitest run` 54/54, `scripts/check-boundary.sh`
  passes. If any of these are red, something changed since 2026-08-22 —
  investigate before proceeding, don't work around it.

---

## Sprint 1: escape corpus CI wiring (G1)

**Goal**: the live browser fixture at `/surface-escape` (already correct — 6/6
blocked, verified 2026-08-22) runs automatically in CI, and is proven capable
of failing.

**Demo/Validation**:
- CI runs a new Playwright spec against `/surface-escape` and it passes.
- Locally, weakening the sandbox flips a named corpus entry to `escaped` and
  fails the spec; reverting restores green.

### Task 1.1: add Playwright as a `web/` dev dependency

- **Location**: `web/package.json`
- **Description**: add `@playwright/test`, a `web:e2e` script running
  `playwright test`, and a minimal `playwright.config.ts` pointing at
  `web/e2e/` with a `webServer` block that starts the Next.js app (prefer
  `next start` against a `next build` for CI fidelity; fall back to `next dev`
  with a readiness poll only if build time makes CI unacceptably slow — record
  which was chosen).
- **Dependencies**: none
- **Acceptance Criteria**: `pnpm --filter harness-web exec playwright --version`
  succeeds; `playwright.config.ts` exists and points at the right base URL.

### Task 1.2: write the escape-corpus e2e spec

- **Location**: `web/e2e/surface-escape.spec.ts` (new)
- **Description**: navigate to `/surface-escape`, wait for `#corpus-status` to
  read `6/6 tested`, then assert every `[data-testid="result-N"]` for
  `N` in `0..5` reads exactly `blocked`. Use the existing `data-testid`
  attributes already present in `SurfaceEscapeFixture.tsx` — no fixture code
  change needed for this task.
- **Dependencies**: 1.1
- **Acceptance Criteria**: spec passes against the current (correct) sandbox.

### Task 1.3: demonstrate the spec can fail, then wire it into CI

- **Location**: `web/surface/SurfaceHost.tsx` (temporary local edit only, not
  committed), `.github/workflows/ci.yml`
- **Description**: temporarily add `allow-same-origin` to the `sandbox`
  attribute string, run the Task 1.2 spec, confirm at least one corpus entry
  (`document.cookie` or `localStorage.setItem` are the two entries that depend
  on same-origin access) flips to `escaped` and the spec fails. Revert the
  temporary change. Then add a CI step running `pnpm --filter harness-web run
  web:e2e` (after building/starting the app per Task 1.1's `webServer` config).
- **Dependencies**: 1.2
- **Acceptance Criteria**: the specific entry name that flipped under the
  weakened sandbox is recorded in this plan's validation checklist below; CI
  step exists and passes on the actual (unweakened) code.
- **Validation**: `git diff` shows no leftover sandbox weakening in the
  committed diff — confirm before committing.

---

## Sprint 2: "always allow" for the approval queue (G2)

**Goal**: an operator can mark a tool always-allow for the rest of the
session; the server enforces it only for tools that would otherwise reach a
prompt (never for `deny`-ACL tools); the client is told exactly what was
granted.

**Demo/Validation**:
- Approving a tool with "always allow this session" checked auto-approves the
  next call to the same tool name without a prompt, and the client receives a
  message naming the tool and `scope: 'session'`.
- A tool the ACL resolves to `deny` is still denied regardless of always-allow
  state — proven by a test that drives the real ACL path, not just the
  always-allow set's contents.

### Task 2.1: extend the protocol

- **Location**: `src/types.ts:168-169` (`tool_approve`), add new
  `ServerMessage` variant `tool_auto_approved`
- **Description**: `tool_approve` gains `remember?: boolean`. Add
  `{ type: 'tool_auto_approved'; id: string; name: string; scope: 'session' }`
  to `ServerMessage`. Regenerate `web/lib/protocol.ts`
  (`node scripts/gen-web-protocol.mjs`).
- **Dependencies**: none
- **Acceptance Criteria**: `node scripts/gen-web-protocol.mjs --check` passes;
  `pnpm typecheck` clean.

### Task 2.2: server-side always-allow set

- **Location**: `src/server/index.ts` — near the existing `pendingApprovals`
  map (~line 304) and the `onToolPrompt` callback (~line 594) and the
  `tool_approve`/`tool_deny` handler (~line 765)
- **Description**: add a per-connection `Set<string>` of always-allowed tool
  names. In the `tool_approve` handler, if `msg.remember` is true, add
  `name` to the set (the handler currently only has `id`; thread the tool
  name through from the matching `pendingApprovals` entry — extend that map's
  value type from a bare resolver to `{ resolve, name }` if needed). In
  `onToolPrompt`, before creating a `pendingApprovals` entry and sending
  `tool_prompt`, check the always-allow set first: if present, resolve `true`
  immediately and send `tool_auto_approved` instead of `tool_prompt`.
  **Do not** touch ACL resolution — this code path only runs for tools that
  already reached `onToolPrompt`, which by construction excludes anything the
  ACL resolves to `deny`. State that constraint in a comment at the point
  where the set is checked, not just in this doc.
- **Dependencies**: 2.1
- **Acceptance Criteria**:
  - A tool approved with `remember: true` is auto-approved on a subsequent
    call within the same session, with no `tool_prompt` sent for it.
  - A `deny`-ACL tool (e.g. `Bash` under `mode: assistant`) is still denied
    even after an always-allow grant for an unrelated tool — this is the test
    that proves G2 didn't accidentally widen the ACL, matching F1's
    ACL-depth-test pattern from the prior fixes pass.
  - `cancel` (`src/server/index.ts:754`) clears the always-allow set in
    addition to `pendingApprovals` — this is the resolved default from the
    design doc's open question; if you ship the opposite, say why in the
    design doc's resolution note.
- **Validation**: new tests in `tests/approval-authority.test.ts` or a new
  `tests/always-allow.test.ts`, whichever fits the existing file's scope
  better — check before adding a new file.

### Task 2.3: wire the UI

- **Location**: `web/components/ops/ApprovalQueue.tsx`
- **Description**: add a checkbox or second button distinguishing "allow" from
  "always allow this session" next to each queued item; send
  `tool_approve` with `remember: true` for the latter. On receiving
  `tool_auto_approved`, render a passive confirmation (toast or log line)
  naming the tool and stating `scope: session` — the UI must echo the
  server's message verbatim, not infer the scope from which button was
  clicked, since "reports what the server actually granted" is the literal
  requirement.
- **Dependencies**: 2.1, 2.2
- **Acceptance Criteria**: `web/tests/approvalQueue.test.ts` covers the new
  button/checkbox and the `tool_auto_approved` rendering path.

---

## Sprint 3: budget-exceeded live wiring (G3)

**Goal**: a run that hits its configured budget shows `budget_exceeded` (not
`done`) on the run board without a page reload, and `Observability` shows a
live cost figure against the configured limit when one exists.

**Demo/Validation**:
- Trigger (or simulate via a unit test on `mergeRunEvent`) a `session_end`
  carrying `status: 'budget_exceeded'` and confirm the run board row reflects
  it live, distinct from both `done` and a generic `failed`.
- `Observability` shows a live-updating cost figure when the profile has
  `max_cost_usd` configured, and shows nothing budget-related when it doesn't.

### Task 3.1: extend `session_end` with a terminal status/reason

- **Location**: `src/types.ts:202`, `src/server/index.ts:594` (`onSessionEnd`
  call site), and wherever `BudgetExceeded` is currently caught — check
  `src/loop/agent-loop.ts` and `src/workflow/runner.ts` first
- **Description**: `session_end` gains
  `status?: 'completed' | 'budget_exceeded' | 'cancelled' | 'failed'` and
  `reason?: string`. Thread the actual status through from the run's outcome
  — the catch site for `BudgetExceeded` (find it, don't assume its location)
  is what needs to set this before `onSessionEnd` fires. Regenerate
  `web/lib/protocol.ts`.
- **Dependencies**: none
- **Acceptance Criteria**: a run that throws `BudgetExceeded` produces a
  `session_end` with `status: 'budget_exceeded'` and `reason` matching
  `BudgetExceeded.reason` (`'cost' | 'tools' | 'wall'`); a normal completion
  produces `status: 'completed'`; `node scripts/gen-web-protocol.mjs --check`
  passes.

### Task 3.2: surface the budget limit at connection time

- **Location**: `src/types.ts:201` (`session_ready`), `src/server/index.ts`
  (session_ready send sites, ~line 504/513)
- **Description**: add an optional `budget?: { max_cost_usd: number }` (or the
  fuller `BudgetConfig` shape if the design doc's reasoning for reusing
  `session_ready` holds up under implementation) to `session_ready`, populated
  from the connection's profile when `autonomy_budget`/equivalent is
  configured, absent otherwise. This is connection-scoped config, matching how
  `allowed_packages` already ships on the same message — don't invent a new
  read endpoint for it, #25 already drew that line at `/datasets` being the
  only new write endpoint and reads going through the `/metrics`-style routes,
  neither of which fits connection-scoped config well.
- **Dependencies**: none (can run in parallel with 3.1)
- **Acceptance Criteria**: a profile with a budget configured sends it in
  `session_ready`; one without sends nothing (not a zero/null placeholder).

### Task 3.3: wire the reducer and UI

- **Location**: `web/lib/reducer.ts` (`mergeRunEvent`-equivalent handling for
  `session_end`, and `session_ready` handling near line 187),
  `web/components/ops/RunBoard.tsx` (`mergeRunEvent`, `runStatusLabel`),
  `web/components/ops/Observability.tsx`
- **Description**:
  - `RunBoard.tsx`'s `mergeRunEvent`: on `session_end` with
    `status === 'budget_exceeded'`, set the row's status to
    `'budget_exceeded'` instead of the current unconditional `'done'`
    (currently `event.type === 'session_end' ? { status: 'done' } : {}` at
    line 12 — this needs the status to come from the event, not be hardcoded).
  - `runStatusLabel` (line 6): add a case for `budget_exceeded` rendering
    distinctly (e.g. `'budget exceeded'`), matching the existing
    `waiting_input` special case as precedent — don't let it fall through to
    the generic `.replace('_', ' ')`.
  - Thread the `session_ready` budget limit and the live `stats.cost_usd`
    (already in the reducer at `web/lib/reducer.ts:189`) into whatever prop
    `Observability` needs to call `budgetState({ cost, limit })` with real,
    live data instead of never being called at all.
- **Dependencies**: 3.1, 3.2
- **Acceptance Criteria**:
  - `web/tests/runBoard.test.ts` covers a `session_end` with
    `status: 'budget_exceeded'` producing a distinct row status.
  - `web/tests/observability.test.ts` covers both the configured-limit case
    (live cost shown, `budgetState` reflects reality) and the no-limit case
    (nothing budget-related rendered — `budgetState` contract of returning
    `'running'` when `limit == null` must not regress into showing a
    misleading number).

---

## Risks

| Risk | Mitigation |
|---|---|
| Sprint 1's Playwright CI step adds meaningful CI time (real browser + real Next.js build) | Scope to exactly one spec file; prefer `next start` over `next dev` for fidelity unless build time is prohibitive, and say which was chosen |
| Sprint 2's always-allow set could be mistaken for an ACL widening if someone later touches this code without reading the constraint | The in-code comment at the check site (Task 2.2) plus the deny-tool test are both required, not either/or — this is exactly the shape of gap F1 found |
| Sprint 2 and Sprint 3 both regenerate `web/lib/protocol.ts` | Land as separate commits; regenerate and run `--check` before each commit, not once at the end |
| Sprint 3's budget limit shape (`{ max_cost_usd }` vs full `BudgetConfig`) is a real design choice, not obvious | Design doc flags it as an open question — resolve during Task 3.2, record the choice in a one-line note the way F8 established the convention for |

## Validation

- [x] Sprint 1: CI runs `web:e2e` and it passes; weakened sandbox flipped
      `window.parent.document.body`, `top.location.href`, `document.cookie`,
      and `localStorage.setItem('x','y')` to `escaped` (CSP/form entries stayed
      `blocked`).
- [x] Sprint 2: always-allow auto-approves within session;
      `tool_auto_approved` names tool and states `scope: session`; deny ACL
      stays denied under any grant (test:
      `tests/always-allow.test.ts — deny ACL cannot be widened by an
      always-allow grant`); cancel clears grants, recorded in design doc.
- [x] Sprint 3: `budget_exceeded` `session_end` produces distinct live
      run-board row; `Observability` shows live configured-limit cost and
      nothing when unconfigured.
- [x] `node scripts/gen-web-protocol.mjs --check` passes after Sprints 2 and 3.
- [x] `pnpm typecheck`, `pnpm test`, `cd web && npx vitest run`,
      `scripts/check-boundary.sh`, and Playwright escape-corpus e2e all green.
- [x] `docs/ROADMAP.md`'s #29 "To build" list reflects the always-allow and
      budget-exceeded bullets as done, with citations.
