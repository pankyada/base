# Autonomy Budget & Conditional ACL — Design (H5)

> Date: 2026-08-02
> Status: Draft (design)
> Related: `docs/superpowers/specs/2026-08-02-watch-poll-triggers-design.md`,
> `docs/superpowers/specs/2026-08-02-provenance-gating-design.md`, `docs/ROADMAP.md`

## Goal

ACL is a three-value verdict per tool name: `allow | prompt | deny`
(`src/tools/acl.ts:4`). It cannot express the only rule that makes unattended
autonomy tolerable:

> *Allow this tool **when the arguments look like this**, ask otherwise.*

Without argument-awareness, every profile faces a bad binary. `Notify: allow`
means an agent can message anyone. `Notify: prompt` means it wakes you to send
its own morning brief. The same applies to file writes (which paths?), calendar
edits (which calendar?), and mail (which recipients?).

Meanwhile a triggered run has no spend ceiling at all. `mode:` states a trust
posture but enforces no resource bound — a looping agent on a cron can burn a
month's budget before anyone notices, and there is no artifact afterward
explaining what it did.

Three pieces, one goal — **autonomy you can bound and audit**:

1. **Budgets** — hard, fail-closed limits on cost, tool calls, and wall time.
2. **Conditional ACL** — data-only predicates over tool arguments.
3. **Audit journal + undo** — an append-only record of every effectful call,
   with the reason it was permitted and how to reverse it.

### Non-goals

- **No code evaluation in predicates.** No JS expressions, no sandboxed lambdas,
  no regex-with-backrefs from config. Predicates are data. A config file that can
  execute is a config file that can be exploited.
- Not a rules engine. No boolean algebra beyond a flat AND-of-conditions list.
- Not a permissions UI. Rendering is the client's job.
- Not a replacement for `mode:` or for provenance gating (H6). This layer can
  only *narrow* trust, never widen it.

---

## 1. Budgets

```yaml
triggers:
  budget: { max_cost_usd: 0.50, max_tools: 30, max_wall_s: 300 }
```

Enforced in `src/loop/agent-loop.ts` at two checkpoints — **before each model
call and before each tool call** — never only at the end of a turn. Checking
after the fact is not a budget, it is a receipt.

```
check(budget, spent)
  ├─ within ──▶ proceed
  └─ exceeded ──▶ abort run
                  status ← 'budget_exceeded'
                  Notify (H1) with what was spent and what was in flight
                  audit entry written
```

Rules:

- **Fail closed.** An unreadable or malformed budget is treated as zero, not
  infinity, and the run refuses to start with a clear error.
- **Applies to triggered runs by default**, interactive runs only if configured —
  a human watching a session is their own budget.
- **Delegated sub-agents inherit a share**, not a fresh allowance. A parent's
  remaining budget is the child's ceiling; otherwise fan-out multiplies spend
  (relevant to `Delegate` and `DelegateFanout`, and to A5b's dev escalation).
- Partial work is preserved: abort appends what happened to the ledger, so the
  run is inspectable and, where the tool supplied one, undoable.

`max_wall_s` also protects against a stuck MCP server, which no cost limit
catches.

---

## 2. Conditional ACL

### 2.1 Shape

An ACL value may be a string (today) or an object (new):

```yaml
tools:
  builtin:
    Notify:
      default: prompt
      allow_if:
        - { arg: channel, in_list: trusted_channels }
    Write:
      default: prompt
      allow_if:
        - { arg: path, under_path: "$VAULT/inbox" }
    MemoryWrite:
      default: allow
      deny_if:
        - { arg: scope, equals: profile }

lists:
  trusted_channels: [phone]
```

Evaluation, deliberately boring:

```
deny_if any match      ─▶ deny        (deny always wins)
allow_if all match     ─▶ allow
otherwise              ─▶ default
```

`allow_if` is AND-of-conditions. Anything needing OR is two entries in a list, or
two rules. This is a hard limit, not an oversight: flat, order-independent rules
are auditable by reading them.

### 2.2 The predicate vocabulary — closed set

| Predicate | Semantics |
|---|---|
| `equals` | exact scalar match |
| `in_list` | membership in a named `lists:` entry or a memory key |
| `matches` | glob (not regex — no catastrophic backtracking, no injection) |
| `under_path` | resolved-realpath containment, symlink-safe |
| `lt` / `gt` | numeric comparison |
| `absent` / `present` | argument presence |

Unknown predicate ⇒ **hard error at profile load**, never a silent skip. A typo
in a security rule must break the boot, not quietly widen access.

`arg` uses dotted paths into the tool input (`recipient.email`). A missing path
evaluates false for `allow_if` and false for `deny_if` — absence never grants.

`under_path` resolves symlinks before comparison. Path containment via string
prefix is a classic escape (`/vault/../etc`); the implementation uses
`realpath` + separator-aware prefix.

### 2.3 List sources

`lists:` in the profile, or `memory:<scope>/<key>` for lists the agent and user
maintain over time (trusted contacts grow). Memory-sourced lists are read at
resolution time with a short cache, and a **read failure denies** rather than
falling through to `default`.

### 2.4 Composition with existing layers

Order is fixed and each layer may only tighten:

```
mode defaults (#12)
  └─▶ profile ACL string/object
        └─▶ conditional predicates (this design)
              └─▶ approval mode (strict/bash/danger/yolo)
                    └─▶ provenance gate (H6)   ← can only escalate to prompt/deny
```

Invariants, each an explicit test:

- `deny` anywhere ⇒ deny. `resolveAcl` already guarantees this
  (`acl.ts:38`); predicates must not be able to undo it.
- `yolo` does not bypass H6. Trust mode is about the *human's* posture toward
  their own agent, not about content the agent read.
- A predicate can turn `prompt` into `allow` only when it matched; it can never
  turn `deny` into anything.

---

## 3. Audit journal and undo

```ts
// src/audit/journal.ts
interface AuditEntry {
  ts: string
  run_id: string
  session_id: string
  user: string
  profile: string
  tool: string
  input_digest: string           // bounded, redacted preview
  effect: 'read' | 'write' | 'outbound' | 'destructive'
  decision: 'allow' | 'prompt' | 'deny'
  decided_by: 'default' | 'predicate' | 'mode' | 'human' | 'gate'
  decided_reason: string         // e.g. "allow_if channel in_list trusted_channels"
  tainted: boolean               // H6
  ok: boolean
  undo?: { kind: string; payload: Record<string, unknown>; expires_at?: string }
}
```

Append-only JSONL at `~/.harness/audit/<user>/<date>.jsonl`, rotated like
telemetry. Distinct from telemetry on purpose: telemetry is sampled, aggregate,
and disposable; audit is complete, per-action, and the thing you read when
something went wrong at 3am.

**`decided_by` + `decided_reason` are the point.** "Why did my assistant send
that?" must be answerable by grep, not by re-reading YAML and guessing.

### 3.1 Undo

Tools *may* return an `undo` descriptor alongside their result. Core stores it
and provides `harness audit --undo <entry_id>`, which dispatches back to the
tool's registered inverse.

Core ships inverses only for its own tools (`Write` → restore prior content from
the ledger, `MemoryWrite` → restore prior value, `MemoryDelete` → restore).
Everything else — unarchive a mail thread, delete a created event — is supplied
by the tool that made the change. Undo is **best-effort and honest**: entries
without a descriptor are listed as not-undoable rather than silently ignored.

`expires_at` encodes real-world reversal windows (an unsend window closes).

---

## 4. Module layout

```
src/tools/acl.ts            + object ACL, predicate evaluation, decision reason
src/tools/predicates.ts     closed predicate set, glob + realpath helpers
src/profiles/schema.ts      + object ACL form, `lists:`, `triggers.budget`
src/runs/budget.ts          accounting + checkpoints + inheritance
src/loop/agent-loop.ts      budget checks before model call and tool call
src/audit/journal.ts        append-only writer + reader
src/audit/undo.ts           inverse dispatch, core inverses
src/cli/audit.ts            harness audit [--undo <id>] [--since] [--tool]
```

`getAcl()` keeps its signature and gains a sibling `resolveAclDecision()`
returning `{ value, decided_by, reason }`, so the loop can audit without
recomputing. The string form of `getAcl` stays for callers that only need the
verdict.

---

## 5. Testing

- **Predicate matrix**: every predicate × match/no-match/absent-arg/malformed-config.
- **Escape attempts**: `under_path` with `..`, symlink out, unicode
  normalization, trailing-separator confusion.
- **Layer invariants**: `deny` unbeatable by any predicate; `yolo` does not
  bypass H6; unknown predicate fails the load.
- **Budget**: 2-tool budget on a 5-tool task aborts at the third check; delegated
  child cannot exceed parent remainder; malformed budget refuses to start.
- **Audit completeness**: property test — every effectful tool call in a run
  produces exactly one audit entry with a non-empty `decided_reason`.
- **Undo**: core inverses round-trip; missing descriptor reports not-undoable.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Predicate language creeps toward a DSL | closed set fixed in this doc; additions require a design change, not a config change |
| A predicate accidentally widens access | deny-wins invariant + layer-order tests; `decided_by` makes every widening attributable |
| "Always allow" from a phone button (H1 §7) writes a bad rule | it writes a *narrow* predicate over the approved argument shape, never `allow` on the tool |
| Audit log grows unbounded | daily files + rotation, matching telemetry; retention configurable |
| Audit leaks secrets in `input_digest` | bounded preview + redaction of known-sensitive arg names; never full input |
| Budget aborts mid-action leaving partial state | checkpoint before tool call; undo descriptors cover the last completed action |
| Memory-sourced lists become an injection target | list reads are scoped to `user`/`profile` memory; agent writes to those scopes are themselves ACL-gated |

## 7. Open questions

1. Should budgets be per-run only, or also per-day-per-profile? A daily ceiling
   is what users actually reason about ("₹200/month"). Leaning: add
   `budget.daily_usd` at the profile level in a follow-up, once per-run works.
2. Should `decided_reason` be surfaced to the model on `prompt`? It would help
   the agent explain itself to the user, but risks the agent optimizing its
   arguments to satisfy predicates. Currently: no.
