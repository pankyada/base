# Routing live evaluation — 2026-09-23 (PT-082, partial)

**Scope:** `scripts/evaluate-routing.ts --live` against real Jev (`jev-1.13.0`, TypeSafe System One endpoint) on the 32-case synthetic corpus `tests/fixtures/routing-evaluation.json` (no private data). Two live runs, identical headline result. Cost cap per run $0.25.

This is evidence about Jev on **synthetic labels written for this project**, not production routing accuracy. The shadow period on a real profile (the other half of PT-082) has not run.

## Headline (current defaults: `ask_threshold` 0.6, `domain_threshold` 0.5)

| Metric | Result |
|---|---|
| Exact match (kind + playbook set + scale) | 13/32 (41%) |
| Kind (ask vs run) | 78% |
| Playbook set, where both ran | 71% |
| Primary playbook, where both ran | 95% |
| Scale exact / within one level | 57% / 95% |

## Failure modes

1. **Over-asking.** 8 of 19 mismatches were clear requests that Jev marked ambiguous above 0.6. Truly ambiguous cases scored 0.76–0.86; two clear ones scored 0.81–0.82, so no threshold separates them perfectly.
2. **Catch-all co-firing.** `generic` (and sometimes `writing`) scores 0.55–0.77 next to the correct specific playbook, which adds a spurious second pass.
3. **Scale off by one.** Nearly all scale misses are adjacent levels; the labels themselves are subjective.

## Offline sweep over recorded live signals (no extra API calls)

| Setting | Kind | Kind + playbooks | Exact |
|---|---|---|---|
| ask 0.6, domain 0.5 (current) | 25/32 | 19/32 | 13/32 |
| ask 0.7, domain 0.5 | 30/32 | 22/32 | 15/32 |
| ask 0.8, domain 0.5 | 28/32 | 20/32 | 13/32 |
| ask 0.7 + catch-all rule | 30/32 | 24/32 | 16/32 |

`domain_threshold` between 0.5 and 0.7 changed almost nothing. Catch-all rule tested: drop `generic` when any other candidate exceeds the domain threshold.

## Recommendations

1. Change default `ask_threshold` 0.6 → 0.7 (clear gain, fewer interruptions).
2. Consider a configurable catch-all list (`router.catch_all: [generic]`) used only when nothing specific qualifies; +2 cases here, small sample.
3. Improve playbook `description` frontmatter — it is the only text Jev routes on and is currently one terse line per playbook.
4. Score scale with a within-one tolerance for acceptance; exact scale labels are too subjective to gate on.
5. Keep `request_routing` in shadow on a real profile before recommending enforce; 32 synthetic cases are too few to set thresholds with confidence.

Reproduce: `npx tsx scripts/evaluate-routing.ts --live --signals-out <file>` (needs `TYPESAFE_API_KEY`).
