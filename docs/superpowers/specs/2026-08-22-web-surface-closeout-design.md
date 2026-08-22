# Web Surface — Closeout Design (W-close)

> Date: 2026-08-22
> Status: Draft (design)
> Related: [`2026-08-16-web-surface-design.md`](2026-08-16-web-surface-design.md),
> [`2026-08-16-web-surface-fixes-design.md`](2026-08-16-web-surface-fixes-design.md),
> [`2026-08-16-operator-assistant-console-design.md`](2026-08-16-operator-assistant-console-design.md),
> [`../plans/2026-08-22-web-surface-closeout.md`](../plans/2026-08-22-web-surface-closeout.md), `docs/ROADMAP.md`

## Goal

#25–#29 are all committed (`71b7a8a`…`143e8c0`). Independent verification on
2026-08-22 found the track substantially done — including F1–F8 from the prior
fixes pass — but three gaps remain, one carried over from F7 and two newly
found while checking #29's "To build" list against the actual code. This
design closes all three.

None of these are new subsystems the way #27–#29 were. G1 tightens an
already-working mechanism. G2 needs one small, genuinely new server capability
(nothing today lets a client mark a tool "always allow" — verified by reading
`src/server/index.ts`'s `tool_approve`/`tool_deny` handling, which carries only
an `id`). G3 is pure wiring — the backend terminal state already exists.

### Non-goals

- Not a re-review of #25–#29 as a whole — scope is exactly the three gaps below.
- Not a redesign of the approval flow — G2 adds one opt-in affordance to the
  existing per-call prompt, it does not change how `tool_prompt`/ACL work.
- Not new budget accounting — `src/runs/budget.ts` and the `budget_exceeded`
  run status already exist and are correct; G3 only pushes that state onto the
  live WS channel the web client already listens to.

---

## G1 — Escape corpus is proven live but not proven in CI (carries over F7)

**Where:** `web/app/_fixtures/surface/SurfaceEscapeFixture.tsx`,
`web/app/surface-escape/page.tsx`, `web/tests/surface.test.ts:35`

F7's fix, verified 2026-08-22, is real and better than the original ask: rather
than a jsdom unit test (which cannot enforce the iframe `sandbox` attribute),
it built a page that mounts a live `SurfaceHost` per corpus entry and runs the
actual payload inside the real sandboxed iframe, reporting `blocked`/`escaped`
per entry via the same `postMessage` bridge surfaces already use. Loaded live
in a browser during verification: **6/6 blocked**, matching what the sandbox
attributes (`sandbox="allow-scripts"`, no `allow-same-origin`, `connect-src
'none'`) predict.

The gap: nothing runs this automatically. `surface.test.ts:35`'s
`escapeCorpus.toEqual([...])` only proves the JSON array's six strings are
unchanged — it says nothing about whether the sandbox still blocks them. If a
future change weakens the sandbox (the exact scenario F7 originally worried
about — someone adds `allow-same-origin` for a plausible reason), the vitest
suite stays green while the live fixture would go red, but nobody is looking
at the live fixture.

**Fix:** drive the existing fixture from CI with Playwright, which is already
available in this environment
(`mcp__plugin_playwright_playwright__*` at the tool layer; add
`@playwright/test` as a `web/` dev dependency for a headless, scriptable CI
run — the MCP tools are interactive/manual, CI needs a non-interactive runner).

- `web/e2e/surface-escape.spec.ts` — navigate to `/surface-escape`, wait for
  `#corpus-status` to read `6/6 tested`, then assert every
  `[data-testid="result-N"]` element's text is exactly `blocked`. The fixture
  already exposes both hooks (`corpus-status`, `result-{index}`) — no fixture
  change needed, this is purely a new test file plus CI wiring.
- Add a `web:e2e` script to `web/package.json` (`playwright test`) and a step
  to `.github/workflows/ci.yml` that starts `next build && next start` (or
  `next dev` if start-up time matters more than fidelity) and runs it.
- Keep `surface.test.ts:35`'s array-equality check — it is cheap and catches
  someone silently dropping or reordering a corpus entry, which the Playwright
  test does not check for on its own (it iterates whatever `corpus.length`
  currently is).

**Demonstrating the test can fail** (do this once, locally, before calling G1
done — do not just add the test and assume it works): temporarily add
`allow-same-origin` to the `sandbox` string in `SurfaceHost.tsx`, run the new
Playwright spec, confirm at least one corpus entry (`document.cookie` or
`localStorage.setItem` are the two `allow-same-origin`-dependent ones) flips to
`escaped` and the spec goes red, then revert. Record which entries flipped in
the plan's validation checklist — that record is what makes this a real
regression test rather than a hopeful one.

---

## G2 — No "always allow" affordance, and no server concept to back it

**Where:** `web/components/ops/ApprovalQueue.tsx`,
`src/server/index.ts` (`tool_approve`/`tool_deny` handling, ~line 765),
`src/types.ts:168-169`

#29's "To build" list asks for: *"an approval queue (unattended runs stack
them), and 'always allow' that reports what the server actually granted."*
`ApprovalQueue.tsx` has the queue (it renders one `<article>` per pending
item) but only ever offers per-call allow/deny — there is no "always allow"
button, and correspondingly **no server-side concept of it exists at all**.
`tool_approve`/`tool_deny` (`src/types.ts:168-169`) carry only `{ id: string }`;
the handler at `src/server/index.ts:765` resolves the matching
`pendingApprovals` callback and does nothing else. There is nothing to "report
what the server actually granted" because nothing is ever granted beyond the
single call.

This is the one genuinely new (small) capability in this closeout, not just UI
wiring — say so plainly rather than treating it as a copy-paste of an existing
pattern.

**Design:**

- Extend `ClientMessage`'s `tool_approve` variant:
  `{ type: 'tool_approve'; id: string; remember?: boolean }`.
- Per-connection state (alongside the existing `pendingApprovals` map): a
  `Set<string>` of tool names marked always-allow for this session only —
  **not** persisted, **not** shared across connections or sessions. This
  matches the track's "single operator, localhost" posture (see
  `web-surface-design.md`'s posture statement) — a durable cross-session grant
  is a bigger decision than this closeout should make unilaterally.
- Where `onToolPrompt` currently always creates a `pendingApprovals` entry and
  sends `tool_prompt` (`src/server/index.ts:594`), check the always-allow set
  first: if the tool name is present, resolve `true` immediately without
  sending `tool_prompt` at all, and instead send a new server message —
  `{ type: 'tool_auto_approved'; id: string; name: string; scope: 'session' }`
  — so the web client can render a passive confirmation instead of a modal.
  **Constraint:** the always-allow set only ever short-circuits calls that
  would have reached `tool_prompt` in the first place — a tool the ACL already
  resolves to `deny` never reaches this code path, so "always allow" cannot
  widen the ACL ceiling. State this constraint in the implementation, don't
  just rely on it being true by construction — F1's ceiling bug is exactly the
  shape of mistake this needs to guard against explicitly.
- `ApprovalQueue.tsx`: add a checkbox or second button — "allow" vs "always
  allow this session" — next to each item. On `tool_auto_approved`, render a
  toast/log line naming the tool and stating `scope: 'session'`, so "reports
  what the server actually granted" is literal: the UI echoes the server's
  message, it does not infer or assume the scope from what the button said.
- Regenerate `web/lib/protocol.ts` after the `src/types.ts` change (the CI
  freshness gate added under #26 will catch a forgotten regen).

**Open question to resolve during implementation, not defer:** does
`cancel` (which already clears `pendingApprovals` — `src/server/index.ts:754`)
also clear the always-allow set? Recommendation: yes — cancel is a hard reset
of in-flight trust, and an operator who cancels a run and starts a new prompt
should not silently inherit standing grants from the aborted one. Record
whichever choice ships as a one-line note in this doc's Open Questions
resolution, matching F8's convention.

**Resolution:** `cancel` clears the per-connection always-allow set. Cancel is
a hard reset of in-flight trust; a new prompt must not inherit the aborted
run's standing grants.

---

## G3 — `budget_exceeded` is a real backend terminal state with no live wire to the web client

**Where:** `src/runs/types.ts:7`, `src/runs/budget.ts`, `src/types.ts:202`
(`session_end`), `web/components/ops/RunBoard.tsx`,
`web/components/ops/Observability.tsx:3`

`RunRecord.status` already includes `'budget_exceeded'` as its own value,
distinct from `'failed'` (`src/runs/types.ts:7`), and `RunBudget` in
`src/runs/budget.ts` throws a typed `BudgetExceeded` error carrying the exact
reason (`cost` / `tools` / `wall`) and a snapshot. `GET /runs` (via
`handleListRuns`, `src/server/rest.ts:680`) already surfaces this status, so a
page load after the fact shows it correctly. The gap is live: the WS
`session_end` message (`src/types.ts:202`) carries only `{ sessionId, run_id?
}` — no status, no reason. `RunBoard.tsx`'s `mergeRunEvent` (line 8-14) never
sets a row to `'budget_exceeded'` because nothing in the live event stream
says so, and `Observability.tsx`'s `budgetState()` (line 3) is a correct pure
function that nothing calls with a real, live `BudgetSnapshot` — verified by
grepping `web/lib/reducer.ts` and `web/lib/protocol.ts`, neither references it.

**Fix:**

- Extend `session_end`: `{ type: 'session_end'; sessionId: string; run_id?:
  string; status?: 'completed' | 'budget_exceeded' | 'cancelled' | 'failed';
  reason?: string }`. Populate it at the one call site
  (`src/server/index.ts:594`, `onSessionEnd`) by threading through whatever the
  run loop already knows when it catches `BudgetExceeded` — check
  `src/loop/agent-loop.ts` and `src/workflow/runner.ts` for where
  `BudgetExceeded` is currently caught, since the catch site is what needs to
  set the reason before calling `onSessionEnd`.
- `mergeRunEvent` (`RunBoard.tsx:8`): on `session_end` with
  `status === 'budget_exceeded'`, set the row's status to `'budget_exceeded'`
  instead of the current unconditional `'done'`. `runStatusLabel` (line 6)
  already has the `waiting_input` special case as precedent; add a
  `budget-exceeded` case there too so it renders distinctly rather than
  falling through to the generic `.replace('_', ' ')`.
- Wire a live `BudgetSnapshot` to `Observability`'s `budgetState()`: the
  `stats` message (`src/types.ts`, already carries `cost_usd`) is the natural
  carrier for the running total: pass `{ cost: msg.cost_usd, limit:
  <profile's max_cost_usd if set> }` through to `Observability` from wherever
  the reducer already stores `costUsd` (`web/lib/reducer.ts:189`). The budget
  *limit* is profile config, not currently sent to the client at all — check
  whether `session_ready` (`src/types.ts:201`) should carry it, or whether a
  `/health`-style read is more appropriate given the "no new write endpoint
  beyond `/datasets`" posture #25 established. Prefer extending
  `session_ready` — it is already the connection-bootstrap message and this is
  connection-scoped config, matching precedent (`allowed_packages` ships the
  same way).
- Regenerate `web/lib/protocol.ts` after both `src/types.ts` changes.

---

## Risks

| Risk | Mitigation |
|---|---|
| G1's Playwright CI step is slow or flaky (real browser, real `next build`) | Scope it to exactly one spec file; if `next build` startup dominates CI time, fall back to `next dev` with a readiness poll rather than dropping the check |
| G2's always-allow set could be mistaken for an ACL change | Explicitly test that a `deny`-tier tool never reaches `tool_prompt` regardless of the always-allow set — same test shape as F1's deeper ACL-path test, not just a ceiling-value check |
| G2 and G3 both touch `src/types.ts` and require `web/lib/protocol.ts` regen | Do the regen once per change, verify with `node scripts/gen-web-protocol.mjs --check` before committing, not after |
| G3's budget limit isn't in every profile (only ones with `autonomy_budget` configured — see #21/#22) | `Observability` must render nothing budget-related when `limit` is absent, not a false `running` — `budgetState()` already returns `'running'` when `limit == null`, keep that contract |

## Validation

- [ ] `web/e2e/surface-escape.spec.ts` exists, runs in CI, and asserts `6/6`
      `blocked`.
- [ ] Demonstrated once: weakening `SurfaceHost.tsx`'s sandbox flips the
      Playwright spec red on a named entry, then passes again after revert —
      the entry name that flipped is recorded in the plan.
- [ ] `tool_approve { remember: true }` auto-approves subsequent calls to the
      same tool name within the session, and the client receives
      `tool_auto_approved` naming the tool and `scope: 'session'`.
- [ ] A `deny`-ACL tool is unaffected by any always-allow state — new test
      exercising the real ACL path, not just the always-allow set's contents.
- [ ] `cancel` behavior toward the always-allow set is decided and recorded as
      a one-line resolution in this doc.
- [ ] A run that exceeds its configured budget shows `budget_exceeded` (not
      `done` or `failed`) on the run board without a page reload.
- [ ] `Observability` renders a live, updating cost figure against the
      profile's `max_cost_usd` when one is configured, and renders nothing
      budget-related when it isn't.
- [ ] `node scripts/gen-web-protocol.mjs --check` passes after both `types.ts`
      changes are made and regenerated.
- [ ] `pnpm typecheck && pnpm test && ./scripts/check-boundary.sh` and
      `pnpm --filter harness-web typecheck && pnpm --filter harness-web test`
      all green.
