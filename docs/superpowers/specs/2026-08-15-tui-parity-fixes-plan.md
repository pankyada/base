# Plan: fix findings from the TUI-parity review

**Generated**: 2026-08-15
**Estimated Complexity**: Medium-High (4 sprints; two are security-critical and gate the others)
**Status**: proposed — not started

## Overview

The 7-sprint TUI-parity plan (`docs/superpowers/specs/2026-08-14-tui-parity-plan.md`) shipped
30 commits with a fully green test suite, then failed independent code review: 10 correctness
bugs, several security-critical, none caught by the implementing agent's own tests because none
of them exercised cross-cutting paths (yolo+plan mode, sub-agent delegation, legacy audit data,
cross-profile config, disconnected clients). Four more cleanup findings were cut from that
review's report for severity but are in scope here per Pankaj's call.

This plan fixes all 14. Scope and three design decisions were confirmed 2026-08-15:
- **Tool-classification lists**: consolidate `EFFECTS`, `MUTATING_TOOLS`, `READ_ONLY_TOOLS` to
  one source now, rather than just patching the two lists missing entries — this is the actual
  root cause of 2 of the 10 bugs and will recur on the next new tool otherwise.
- **Legacy undo entries**: refuse to restore by default, with an explicit override — not the
  original spec's warn-and-proceed, which the review showed still clobbers silently.
- **`ui_render` for TUI clients**: fail fast via a capability flag, not a new Go rendering
  surface — `RenderUI`'s html/css/js payload isn't meaningful in a terminal anyway.

### Sprint dependency graph

```
S1 tool-list consolidation ──┬── gates S2 (stage-acl and ACL fixes both read from the new source)
S2 ACL/stage-overlay fixes ──┘
S3 plan-mode + undo fixes ──── independent of S1/S2, can run in parallel
S4 cleanup (4 cut findings) ── independent, can run anytime, lowest priority
```

Do S1 before S2 — S2's fixes are additions to lists S1 is about to restructure; sequencing
avoids a rebase across the exact lines both touch. S3 and S4 don't touch S1/S2's files and can
run in parallel with them.

## Prerequisites

- Read `docs/ADR.md` — ADR-66 (project-context trust decision) and the new stage-ACL-ordering
  entry are both directly relevant to S2/S3.
- This plan assumes the 30-commit TUI-parity branch is the current `HEAD`. If it has moved,
  re-verify line numbers before starting — several are already approximate from the review.

---

## Sprint 1: consolidate tool-classification lists

**Goal**: One canonical map of tool → mutation/effect class. `MUTATING_TOOLS` and
`READ_ONLY_TOOLS` derive from it instead of hand-listing tool names a second and third time.

**Demo/Validation**:
- Add a fake new `outbound`-effect tool to `EFFECTS` in a scratch test; confirm both
  `MUTATING_TOOLS`-gated approval modes and the stage-ACL overlay treat it as mutating/denied
  without touching either list by hand.
- `pnpm test` and `pnpm typecheck` green.

### Task 1.1: derive `MUTATING_TOOLS` from `EFFECTS`

- **Location**: `src/tools/acl.ts:16`, `src/tools/effects.ts`
- **Description**: `EFFECTS` (`effects.ts:3-9`) already classifies every built-in tool as
  `read`/`write`/`outbound`/`destructive`. Replace the hand-maintained `MUTATING_TOOLS` set
  with a derived one: every tool whose `effectFor(name)` is not `'read'` is mutating. For MCP
  tools (not in the static `EFFECTS` map), keep `effectFor`'s existing heuristic
  (`effects.ts:11-15`) — it already returns non-`'read'` by default, so the derived set
  naturally covers them without a name list.
- **Dependencies**: none
- **Acceptance Criteria**:
  - Every tool previously in `MUTATING_TOOLS` is still classified as mutating (no regression).
  - `WebFetch`/`WebSearch`/`Notify`/`MemoryWrite` are now included, since `effects.ts` already
    classifies them as `outbound`/`write`.
  - Adding a new tool to `EFFECTS` alone is sufficient for `modeDecision` to treat it correctly
    — no second edit required.
- **Validation**: vitest — parametrize over every key in `EFFECTS`, assert `strict`/`bash` mode
  resolution matches the tool's effect class.

### Task 1.2: derive `READ_ONLY_TOOLS` (stage overlay) from `EFFECTS`

- **Location**: `src/workflow/stage-acl.ts:6-19`, `src/tools/effects.ts`
- **Description**: Replace the hand-maintained `READ_ONLY_TOOLS` set the same way: a tool is
  denied during `recon`/`plan`/`design` stages if `effectFor(name)` is not `'read'`. This is a
  slightly different rule from Task 1.1 (Task 1.1 checks "not read" for approval-mode gating;
  this checks the same predicate for stage gating) — both can share one helper, e.g.
  `isMutatingEffect(effect: ToolEffect): boolean` in `effects.ts`, used by both `acl.ts` and
  `stage-acl.ts`.
- **Dependencies**: 1.1 (introduces the shared predicate)
- **Acceptance Criteria**:
  - `WebFetch`/`WebSearch`/`Notify`/`MemoryWrite` are now denied during recon/plan/design,
    closing the gap the review found.
  - `Write`/`Edit`/`Bash`/`ExecuteCode`/`Delegate`/`MemoryDelete` remain denied (no regression).
  - `build`/`verify`/`review` stages are unaffected — `stageAcl` still returns `{}` for them.
- **Validation**: extend the existing (stage × mode) matrix test to assert every non-`'read'`
  tool is denied for `recon`/`plan`/`design`, generated from `EFFECTS` rather than hand-listed.

---

## Sprint 2: close the ACL/stage-overlay bypasses

**Goal**: The stage-ACL overlay actually holds for every path that can mutate during a
read-only stage, including sub-agent delegation.

**Demo/Validation**:
- Manually: start a workflow-enabled profile with an `agents:` block, run `/plan` in yolo mode,
  have the agent attempt to call the named sub-agent tool during the plan stage — confirm it is
  denied or the sub-agent itself cannot write.
- `strict` mode + WebFetch → confirm an approval prompt now appears (was silent-allow before).

### Task 2.1: thread the stage overlay into sub-agent loops

- **Location**: `src/agents/runner.ts:90`, `src/loop/agent-loop.ts` (the `opts` parameter
  consumed at line 61)
- **Description**: `runAgentLoop`'s sub-agent invocation in `runner.ts:90` does not pass the
  parent's `opts` (which carries `stage`) through to the sub-agent's own loop, so the
  sub-agent's ACL resolution has no idea it's running inside a read-only stage. Thread the
  parent's stage context into the sub-agent call so `resolveAcl`/`resolveAclDecisionWithMemory`
  inside the sub-loop apply the same overlay. This is the correct fix per the review's altitude
  finding — deny-by-name at the top level is a bandaid; the overlay should propagate to
  wherever tool calls actually happen, including inside delegation.
- **Dependencies**: Sprint 1 (uses the consolidated predicate to decide what's denied)
- **Acceptance Criteria**:
  - A sub-agent invoked during a recon/plan/design stage inherits the same read-only
    restriction as its parent — verified via the same (stage × mode) test harness extended to
    cover a sub-agent call, not just a top-level one.
  - A sub-agent invoked OUTSIDE a workflow stage (normal delegation) is unaffected.
  - `Delegate` and `DelegateFanout` themselves also stay denied at the top level during those
    stages (belt-and-suspenders — see Task 2.2), so both single-shot delegation and the
    `agents:` mechanism are covered.
- **Validation**: vitest driving a stubbed sub-agent loop through `runner.ts`, asserting the
  overlay is present in the sub-loop's resolved ACL context.

### Task 2.2: add `DelegateFanout` and named sub-agent tools to the stage deny set

- **Location**: `src/workflow/stage-acl.ts`, `src/tools/builtin/delegate-fanout.ts`,
  `src/agents/loader.ts:50`
- **Description**: `DelegateFanout` is a fixed tool name — add it to the derived-from-`EFFECTS`
  deny set from Sprint 1 (it should already be `'destructive'` or similar in `EFFECTS`; if not,
  classify it there rather than adding a second special case here). Named sub-agent tools
  (`entry.name` from `src/agents/loader.ts:50`) are NOT fixed names and can't be listed
  statically — Task 2.1 is what actually closes this gap for them (the sub-agent's own loop
  respects the overlay once it's threaded through), so this task's job is confirming
  `DelegateFanout` specifically, and documenting in a code comment why named sub-agents are
  intentionally handled via propagation (2.1) rather than a name list here.
- **Dependencies**: 2.1
- **Acceptance Criteria**: `DelegateFanout` denied during recon/plan/design; a comment in
  `stage-acl.ts` explains the propagation-vs-naming split so a future reader doesn't "fix" it
  by adding sub-agent names to the static list.
- **Validation**: covered by the same matrix test extended in 2.1.

---

## Sprint 3: plan-mode approval integrity + undo safety

**Goal**: Approving a plan actually sticks. Undoing a legacy entry never silently clobbers.

**Demo/Validation**:
- `/plan` → approve → confirm the SAME plan text that was shown is what persists in `plan.md`
  and what the follow-on run uses as context (no second, different plan appears).
- `/undo` on a pre-upgrade audit entry whose file has since changed → refused, with a clear
  message and an explicit way to override; overriding actually restores.
- `/undo` on a pre-upgrade entry whose target file no longer exists → clean "not found" notice,
  not a server crash.

### Task 3.1: stop re-running workflow staging after plan approval

- **Location**: `src/server/index.ts` (`handlePlanRequest`, around line 420-430),
  `src/workflow/runner.ts`
- **Description**: This is actually implementing the ORIGINAL Sprint 6 spec correctly — Task
  6.2's acceptance criteria said "Proceed injects the plan body as context for the follow-on
  run," which means the follow-on turn should be a normal (non-staged) agent run using the
  approved plan as context, not a full re-entry into `runWorkflow`. Fix: when re-injecting the
  approved-plan message, mark it (a flag on the synthetic message, or a parameter on whatever
  internal function actually starts the run) so the handler does NOT call `runWorkflow` for
  this specific turn even if `workflow.enabled` is true — call the plain agent loop instead,
  with the approved plan text prepended as context.
- **Dependencies**: none
- **Acceptance Criteria**:
  - After approval, `plan.md` is written exactly once per plan-request, with the content the
    user actually saw.
  - The follow-on run does not re-triage or re-run recon/plan stages.
  - `workflow.enabled: false` profiles are unaffected (they never hit this path differently).
  - "Edit" (not just "proceed") also doesn't trigger re-staging — edited text follows the same
    non-staged follow-on path.
- **Validation**: vitest driving `plan_request` → proceed, asserting `writeArtifact` is called
  exactly once and the follow-on `runAgentLoop` call (not `runWorkflow`) receives the approved
  plan text.

### Task 3.2: refuse-by-default restore for legacy (unhashed) undo entries

- **Location**: `src/audit/undo.ts:19-29`, `src/server/undo-handlers.ts`, `src/types.ts` (for
  the override signal), `tui/internal/ui/undo.go`
- **Description**: Restructure the `!payload.existed`/hash-check logic so a legacy entry
  (`after_sha256` absent) defaults to **refuse**, returning a distinct result (e.g.
  `{ ok: false, reason: 'legacy_unverified' }`) instead of either the old unconditional
  overwrite or a post-hoc warning. Add an explicit override path: `undo_apply` gains an
  optional `force: true` field; the TUI's undo panel, on a refused legacy entry, offers a
  second confirm ("restore anyway — cannot verify the file hasn't changed") that resends with
  `force: true`. `force` must ONLY bypass the legacy-unverified refusal, never the hash-mismatch
  refusal for entries that DO have a hash and demonstrably don't match — that case stays a hard
  refusal with no override, since it's not "unknown," it's "known wrong."
- **Dependencies**: none
- **Acceptance Criteria**:
  - Legacy entry, file unchanged or already gone: default call refuses; `force: true` restores
    (or, for a deletion-undo where the file's already gone, no-ops cleanly rather than erroring).
  - Legacy entry with `force: true`: restores/removes as before Task 3.3's crash fix, i.e. via
    the guarded path, not the old unconditional one.
  - Hashed entry with a mismatch: refuses regardless of `force` — this path is unchanged from
    what Sprint 7 originally shipped.
- **Validation**: vitest covering all four combinations (legacy/hashed × matched/unmatched ×
  force/no-force); Go test for the undo panel's second-confirm flow.

### Task 3.3: guard `unlinkSync` for legacy deletion-undo, and catch the whole apply path

- **Location**: `src/audit/undo.ts:26`, `src/server/undo-handlers.ts`, `src/server/index.ts`
  (`undo_apply` handler)
- **Description**: Restore the `existsSync` guard before `unlinkSync` that existed pre-diff
  (independent of Task 3.2's refuse/override logic — this fixes the crash even for a `force:
  true` legacy restore whose target file is already gone). Separately, wrap `applyUndoEntry`'s
  call to `undoAuditEntry` in try/catch in `undo-handlers.ts`, and confirm the `undo_apply`
  case in `src/server/index.ts` converts any thrown error to a `notice` message rather than
  letting it propagate — matching how every other message-type branch in that handler already
  behaves. This is defense in depth: 3.2 removes the main trigger, 3.3 makes sure no undo path
  can ever crash the process even if a future change reopens one.
- **Dependencies**: 3.2 (touches the same function)
- **Acceptance Criteria**:
  - Undoing a deletion whose target is already gone never throws, with or without `force`.
  - Any unexpected error anywhere in `undoAuditEntry` reaches the client as a `notice`, never
    an unhandled rejection.
- **Validation**: vitest forcing `unlinkSync` to throw (mock fs), asserting the WS handler
  responds with a notice and the process does not crash (no unhandled rejection listener firing).

---

## Sprint 4: cleanup (the 4 findings cut from the review report)

**Goal**: No live bug in this sprint — maintainability and doc-currency only. Lowest priority;
fine to interleave with S1-S3 or do last.

### Task 4.1: reuse `predicates.ts`'s realpath-containment check

- **Location**: `src/context/project-context.ts:9-24`, `src/tools/predicates.ts:35-62`
- **Description**: Export `realpathForContainment`/the `under_path` containment logic from
  `predicates.ts` and import it from `project-context.ts` instead of the independent
  reimplementation. The review confirmed no circular-dependency risk (`predicates.ts` has zero
  internal deps). `predicates.ts`'s version handles not-yet-existing leaf path segments;
  `project-context.ts`'s callers always operate on already-`existsSync`-verified paths, so the
  more general version is a strict superset — safe to swap in.
- **Dependencies**: none
- **Acceptance Criteria**: one containment implementation; `project-context.ts`'s existing
  symlink-escape tests still pass unmodified against the shared helper.
- **Validation**: existing vitest suite for both modules, unchanged assertions.

### Task 4.2: derive `project-context.ts`'s discovery roots from `resolveSkillsDirs`

- **Location**: `src/context/project-context.ts:27-33`, `src/skills/loader.ts:24`
- **Description**: Follow the pattern `src/skills/commands.ts:22` already established for this
  exact situation (a sibling discovery root set) — derive from `resolveSkillsDirs()` rather
  than independently hand-listing the same four levels in the same order.
- **Dependencies**: none
- **Acceptance Criteria**: discovery order and precedence unchanged; verified by the existing
  four-level precedence test continuing to pass.
- **Validation**: existing vitest suite, unchanged assertions.

### Task 4.3: unify skill-as-command and file-backed-command dispatch

- **Location**: `tui/internal/ui/model.go` (`handleSlash`, `installedSkill`, `customCommand`),
  `tui/internal/ui/completion.go`, `src/types.ts`, `src/server/index.ts`
- **Description**: This is a larger refactor than 4.1/4.2 — do it last, and treat the other
  three sprints as higher priority if time is short. Replace the two parallel lookup paths with
  one "resolve invocable by name" step that returns a tagged union (skill vs custom command),
  branching only at the final prompt-construction step (the two ARE legitimately different
  there, per the plan's own documented 2026-08-14 decision — don't unify that part). On the
  wire, this can stay as two message types (`skills`/`commands`) if merging them is a bigger
  protocol change than warranted — the goal is one Go-side dispatch structure, not necessarily
  one wire format.
- **Dependencies**: none, but touches the same file as Sprint 1/2's Go-side work only
  incidentally (no real file overlap with S1-S3, which are TS-only)
- **Acceptance Criteria**: adding a third invocable kind in the future requires one new match
  arm in the resolve step, not a new parallel field/lookup/branch.
- **Validation**: `tui/internal/ui/app_test.go` — both a skill invocation and a custom-command
  invocation still dispatch correctly through the unified path.

### Task 4.4: update `docs/ROADMAP.md` and the plan doc's status line

- **Location**: `docs/ROADMAP.md`, `docs/superpowers/specs/2026-08-14-tui-parity-plan.md:5`
- **Description**: Add a numbered ROADMAP.md entry for the shipped TUI-parity work (per
  CLAUDE.md's explicit rule that feature status lives there), and flip the plan doc's header
  from "Status: proposed — not started" to reflect reality. Do this LAST, after Sprints 1-3 are
  actually merged — the honest status at that point is "shipped, then fixed" (link both spec
  docs from the ROADMAP entry), not "shipped."
- **Dependencies**: Sprints 1-3 merged (so the status written is accurate)
- **Acceptance Criteria**: ROADMAP.md entry present; both spec docs' status lines match reality.
- **Validation**: manual read-through; no test applies to documentation.

---

## Testing Strategy

| Layer | Command | Applies to |
|---|---|---|
| Vitest | `pnpm test` | S1, S2, S3, S4.1, S4.2, S4.4 (n/a) |
| Go unit + app-flow | `cd tui && go test ./...` | S3.2 (undo panel), S4.3 |
| Types | `pnpm typecheck` | every TS sprint |
| Manual | `pnpm dev` + `pnpm dev:tui` | each sprint's demo checklist |

S2 additionally requires re-running the exact (stage × mode) matrix test built for the original
Sprint 6 — this plan extends it rather than replacing it, so a regression there is directly
comparable to the original review's verified baseline.

## Potential Risks & Gotchas

1. **S1 is a refactor of security-relevant code with no behavior change intended.** The
   temptation is to also "clean up" `EFFECTS`'s existing classifications while touching the
   file. Don't — any reclassification is itself a security-relevant change and belongs in its
   own reviewed commit, not bundled into a consolidation.
2. **S2 Task 2.1's propagation fix is the one most likely to have a scope surprise.** Thread too
   little and named sub-agents stay unrestricted; thread too broadly and you might restrict
   sub-agents OUTSIDE workflow stages too (they should be unaffected — normal delegation isn't
   supposed to inherit a stage that doesn't exist). Test both directions explicitly.
3. **S3 Task 3.1's "don't re-run workflow for this turn" flag needs to not leak.** If the
   no-restage marker on the synthetic message is implemented sloppily (e.g. a profile-level
   flag instead of a per-message one), it could accidentally suppress staging for the NEXT
   unrelated user message too. Scope it to the single re-injected message only.
4. **S3 Task 3.2's `force` field is a new user-facing escape hatch on a destructive action.**
   Make sure the TUI's second-confirm is not a single accidental keypress away from the first
   (this is exactly the kind of UX mistake that turns a safety fix into a false sense of safety).
5. **S4.3 is the highest-effort, lowest-value task in this plan.** If time is constrained, cut
   it first — nothing else depends on it, and it fixes no live bug.

## Rollback Plan

- **S1**: revert the two list-derivation commits; the original hand-maintained lists return
  with their original (buggy) contents — this is a regression, not a safe rollback, so treat S1
  as a unit with S2, not independently revertable in production.
- **S2**: each task is independently revertable; reverting 2.1 alone restores the sub-agent
  bypass but does not affect S1's consolidation.
- **S3**: Task 3.1 and 3.2/3.3 are independently revertable. Reverting 3.2 restores the original
  warn-and-proceed behavior for legacy entries (a known-worse but previously-shipped state, not
  a crash risk on its own — 3.3 should be kept even if 3.2 is reverted).
- **S4**: purely additive/cosmetic; revert any task individually with no interaction effects.
