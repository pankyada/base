# Temporal Memory — Design (H3)

> Date: 2026-08-02
> Status: Draft (design)
> Related: `docs/superpowers/specs/2026-08-01-context-projection-design.md`,
> `docs/superpowers/plans/2026-08-02-personal-assistant-plan.md`, `docs/ROADMAP.md`

## Goal

Memory today is a key→content map with optional typed links
(`src/memory/interface.ts`). Every fact is implicitly eternal and implicitly
current. That is correct for "the user prefers TypeScript" and wrong for almost
everything an assistant learns:

| Fact | What eternal-key memory does |
|---|---|
| "Flight to Delhi on the 14th" | still asserted in December |
| "Rent due on the 5th" | either fires never or is re-derived every time |
| "Ravi is my manager" (until March) | silently contradicts the newer fact |
| "Budget is ₹40k/mo this quarter" | overwrites the previous quarter, history lost |

The failure mode is not missing data — it is **confidently stale data**, which is
worse than no memory at all because the agent acts on it.

This design adds a time dimension to memory: validity intervals, recurrence, and
a query interface that takes a clock. A fact stops being "true" and becomes "true
between these instants". Supersession replaces overwrite.

### Non-goals

- **Not a calendar.** Recurrence here describes *when a fact holds*, not events
  to display. Calendars are MCP integrations.
- **Not a reminder scheduler.** Firing at a time is H4's job (triggers); this
  answers "what is true at time T".
- **Not a vector store.** Retrieval stays lexical + structural, consistent with
  the projection design's rejection of embedding retrieval.
- **Not a schema migration.** Files without temporal frontmatter keep working,
  forever, unchanged.
- **No new dependency for RRULE.** A bounded subset is implemented in-tree (§3).

---

## 1. Frontmatter extension

`FsMemoryProvider` already stores links in gray-matter frontmatter. Temporal
fields join them:

```markdown
---
links:
  - target: ravi
    relation: manager
valid_from: 2026-08-14T00:00:00+05:30
valid_until: 2026-08-21T00:00:00+05:30
entity: travel/delhi-trip
confidence: 0.9
supersedes: travel-delhi-trip-v1
---
Flight AI-812 to Delhi, 14th, 09:40 IST. Return on the 21st.
```

| Field | Meaning | Absent means |
|---|---|---|
| `valid_from` | fact begins holding | beginning of time |
| `valid_until` | fact stops holding | end of time |
| `recur` | RRULE subset; fact holds on each occurrence | non-recurring |
| `entity` | what this fact is *about* | ungrouped |
| `confidence` | 0–1, source-dependent | 1.0 |
| `supersedes` | key of the fact this replaces | replaces nothing |

**Back-compat is the load-bearing property:** every field is optional and every
absence maps to today's semantics. An existing memory file parses to
`(-∞, +∞), confidence 1.0` — which is exactly what it means today.

Timestamps are stored as ISO-8601 **with offset**, never naive. The originating
timezone is part of the fact: "9am standup" means 9am *somewhere*, and a user who
travels breaks any design that normalizes to bare UTC.

---

## 2. The `Recall` tool

```ts
Recall({
  at?: string,          // instant; default now
  window?: string,      // "next 7d", "last 30d", "2026-08-01..2026-08-31"
  entity?: string,      // exact or prefix ("travel/")
  relation?: string,    // traverse links, like MemoryLinked
  text?: string,        // lexical filter
  scope?: 'session'|'profile'|'user'|'project',
  limit?: number,       // default 20
}) → string
```

Evaluation order — filter before rank, cheapest first:

```
scope select ─▶ temporal filter ─▶ entity/relation filter ─▶ lexical
             ─▶ supersession collapse ─▶ rank ─▶ limit
```

**Supersession collapse** is the step that makes memory trustworthy: within one
`entity`, when several facts are valid at `at`, the one with the latest
`valid_from` wins and the others are dropped from the result (not from disk).
`Recall({ at: <past> })` still returns the historical answer. Nothing is ever
lost; only the *current* view is deduplicated.

Ranking: validity specificity (a fact valid for a day beats one valid forever)
→ recency of `valid_from` → confidence → lexical score. Specificity first because
"my flight is Thursday" should outrank "I usually travel by train".

`MemoryRead` is unchanged. `Recall` is the time-aware query surface; `MemoryRead`
remains the direct key fetch.

---

## 3. Recurrence subset

Full RFC 5545 is a trap — it is large, and the parts an assistant needs are
small. Implemented in `src/memory/recurrence.ts`, no dependency:

```
FREQ = DAILY | WEEKLY | MONTHLY | YEARLY
INTERVAL = n
BYDAY = MO,TU,WE,TH,FR,SA,SU        (WEEKLY, and MONTHLY with ordinal: 2FR)
BYMONTHDAY = 1..31 | -1             (-1 = last day of month)
UNTIL | COUNT
```

Expansion is windowed and bounded: `expand(rule, from, to, cap = 366)`.
Unbounded expansion is not exposed at all.

Three correctness cases that get explicit table-driven tests, because each is a
real-world bug in shipped assistants:

1. **Month-end.** `BYMONTHDAY=31` in a 30-day month → skipped, not clamped to the
   30th. `-1` is the way to say "last day".
2. **DST.** A 9am local recurrence stays 9am local across a transition; the UTC
   instant shifts. Computation happens in the fact's stored zone, then converts.
3. **Leap day.** `YEARLY` on Feb 29 occurs only in leap years.

---

## 4. Interface changes

```ts
export interface TemporalMeta {
  valid_from?: string
  valid_until?: string
  recur?: string
  entity?: string
  confidence?: number
  supersedes?: string
}

export interface MemoryProvider {
  // existing methods unchanged in signature and behavior
  write(scope, key, content, links?, temporal?: TemporalMeta): Promise<void>
  query(scope, q: RecallQuery): Promise<MemoryEntry[]>     // new
}
```

`write`'s new parameter is trailing and optional — no call site changes.
`query` gets a default implementation in a shared base so `GraphMemoryProvider`
inherits temporal filtering and only overrides traversal, keeping the two
providers behaviorally consistent.

---

## 5. Interaction with context projection (#16)

Temporal metadata gives the decay ladder better signals than recency alone:

- **Expired facts evict first**, before any tier-1 elision of live content. A
  fact whose `valid_until` has passed is the cheapest possible thing to drop.
- **Superseded facts are demoted, never dropped from the ledger** — they leave
  the projection but stay recallable at a past `at`.
- **Imminent facts pin.** A fact becoming valid inside the next 24h is a
  promotion candidate for the prefix band, because "your flight is tomorrow" is
  exactly what should survive compaction.
- `buildSystemPromptSection()` filters to facts valid *now*. This alone removes a
  category of confident-stale-answer bugs at zero query cost.

---

## 6. Where facts come from

Core provides the substrate, not the extraction. Two existing producers gain
temporal output without new machinery:

- **The improver** (`src/improver/default-improver.ts`) already writes reflections
  at session end; it gains the ability to attach validity when the source text
  contains one.
- **Workflow knowledge extraction** (#15) already writes project facts at stage
  close; same addition.

Everything else — parsing "my lease ends in March" out of an email — is a product
concern implemented as a skill. Core must never contain a date-phrase parser for
a specific domain.

---

## 7. Module layout

```
src/memory/interface.ts     + TemporalMeta, query()
src/memory/temporal.ts      parse/serialize frontmatter, validity predicates
src/memory/recurrence.ts    bounded RRULE subset + windowed expansion
src/memory/query.ts         shared filter/collapse/rank used by both providers
src/memory/fs-memory.ts     wire temporal frontmatter
src/memory/graph-memory.ts  wire temporal on nodes
src/tools/builtin/recall.ts Recall tool
src/context/                expired-first eviction, imminent-fact pinning
```

---

## 8. Testing

- **Frozen clock everywhere.** Every temporal test injects `now`; no test reads
  the system clock.
- **Old-format fixture** directory that must load unchanged — the back-compat
  guard, run in CI on every memory change.
- **Table-driven recurrence** across DST transitions (both directions), month
  lengths, leap years, and `UNTIL`/`COUNT` interaction.
- **Supersession** test asserting the historical answer is still retrievable.
- **Timezone travel** test: fact written in IST, queried while the process runs
  in UTC.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Timezone bugs (the classic) | store offset always; compute in the fact's zone; explicit travel test |
| Recurrence scope creep toward full RFC 5545 | the subset is fixed in this doc; anything more is a rejected feature, not a backlog item |
| Silent supersession losing information | collapse affects results only; disk is append-only; `at` recovers history |
| `Recall` cost on large stores | filter-before-rank; per-scope directory listing already bounded; index file if lists exceed ~5k entries |
| Two providers diverging | shared `query.ts`; conformance suite run against both |

## 10. Open questions

1. Should `confidence` decay with age automatically, or only when a source
   restates it? Leaning explicit-only — automatic decay is unexplainable to a user.
2. Do we need `valid_from` inference (fact created now ⇒ `valid_from = now`)?
   Risk: it makes every fact look time-bounded. Currently: no, absence means eternal.
