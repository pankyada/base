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


## Shadow-period runbook (approved coding profile)

The user approved the `coding` profile. `profiles/coding.yaml` is configured in the working tree with `request_routing`, `edge_checks` and `claim_check` all `shadow`, candidates `[coding, generic]`, and `catch_all: [generic]`. Automated `loadProfile` parsing confirmed these values; this establishes local setup only. On normal workflow stage/session events, request routing sends bounded request text and playbook descriptions; edge checks send bounded request/stage artifact context; claim checks send extracted claims with bounded evidence when applicable. All three features are configured as shadow. Next, use a runtime loading this file for normal representative work. The observation period has not started and no profile telemetry exists yet. Current-state check on 2026-09-23: `pnpm exec tsx src/cli/index.ts stats routing --json` returned `routeGraph.hasData=false`, empty playbooks/confusion and no edge or claim totals. Record the configuration, observation dates and request count. Review whether proposed playbooks, clarification decisions and scale fit each request; record sanitized outcomes without private request text.

Inspect collected evidence from the same harness user/data context:

```sh
harness stats routing
harness stats routing --suggest
harness stats routing --json
```

The CLI reads stored telemetry across profiles; isolate the observation dataset or identify mixed-profile evidence before attributing results to the approved profile. Suggestions are advisory and do not apply themselves. `No routing data`, `n/a` and `insufficient data` leave the corresponding gate open.

Good evidence means representative task coverage with recorded denominators; few unnecessary asks, provider fallbacks or inappropriate catch-all selections; plausible scale (including within-one tolerance); and reviewed route/edge disagreements. Report reroute rate, edge agreement and claim results only where those features actually supplied observations. Shadow proposals do not prove that enforce actions succeed. Compare first-try completion, rework and cost with the existing workflow where comparable outcomes exist.

Recommend enforce only after a real-profile shadow period is documented, recurring misroutes and disagreements are resolved or explicitly accepted, provider fallback behavior is acceptable, and the user has reviewed the observed tradeoffs. The synthetic corpus and automated checks alone cannot close PT-082. Record the evidence and recommendation in the tracker; obtain user approval before changing the real profile to enforce.


## Follow-up — 2026-09-23 (PT-082, partial)

Implemented optional `router.catch_all` (default `[]`), configured the synthetic evaluator with `[generic]`, and expanded playbook descriptions. A fresh real-provider run used `ask_threshold: 0.7` plus this catch-all configuration and the updated descriptions. These changes and this follow-up are working-tree work; the earlier implementation was pushed to `origin/main` at `4dda7f3`.

| Metric | Earlier live run, old defaults | Follow-up live run |
|---|---|---|
| Exact match | 13/32 (41%) | 18/32 (56.3%) |
| Kind | 78% | 94% |
| Playbook set, where both ran | 71% | 81% |
| Primary playbook, where both ran | 95% | 88% |
| Scale exact, where both ran | 57% | 62% |
| Scale within one, where both ran | 95% | 92% |

Both runs use the same 32 synthetic cases. The playbook/primary/scale percentages are conditional on both expected and actual decisions being `run`; those denominators differ between runs. Primary accuracy and within-one scale accuracy declined, so the overall exact-match gain is not a uniform improvement.

Replaying each recorded signal set through different policies isolates policy effects without new provider calls. In the table, exact and kind use all 32 cases; set, primary, scale and within-one counts use the “both ran” denominator. Old defaults mean ask 0.6 and domain 0.5; the other rows retain domain 0.5.

| Recorded signals | Policy | Exact /32 | Kind /32 | Set correct | Primary correct | Scale exact | Within one | Both ran |
|---|---|---|---|---|---|---|---|---|
| Earlier | Old defaults | 13 | 25 | 15 | 20 | 12 | 20 | 21 |
| Earlier | Ask 0.7 | 15 | 30 | 18 | 23 | 15 | 24 | 26 |
| Earlier | Ask 0.7 + catch-all | 16 | 30 | 20 | 23 | 15 | 24 | 26 |
| Follow-up | Old defaults | 13 | 23 | 16 | 17 | 10 | 18 | 19 |
| Follow-up | Ask 0.7 | 18 | 30 | 21 | 23 | 16 | 24 | 26 |
| Follow-up | Ask 0.7 + catch-all | 18 | 30 | 21 | 23 | 16 | 24 | 26 |

On earlier signals, ask 0.7 adds two exact matches and catch-all adds one more. On follow-up signals, ask 0.7 adds five exact matches; catch-all adds none. At the same ask-0.7-plus-catch-all policy, follow-up signals score 18/32 versus 16/32 earlier. That difference is consistent with improved descriptions, but does not isolate their effect: descriptions changed between provider runs, and provider variation remains possible. No controlled repeated description-only comparison was run.

This remains synthetic routing evidence, not production accuracy or completed live acceptance. The approved coding profile now has working-tree shadow configuration, confirmed by automated profile loading only. Normal use on a runtime loading that file is next; the observation period has not started, no profile telemetry exists yet, and enforce is not recommended. Current-state check on 2026-09-23: `pnpm exec tsx src/cli/index.ts stats routing --json` returned `routeGraph.hasData=false`, empty playbooks/confusion and no edge or claim totals. Final working-tree validation: `pnpm typecheck` clean; `pnpm test`: 206 files passed / 1 skipped (207), 1,351 tests passed / 3 skipped (1,354), six added tests over the 1,345-pass baseline with the same 206 passing files; `node scripts/gen-web-protocol.mjs --check` exit 0 with no output; offline `npx tsx scripts/evaluate-routing.ts`: 32 cases, 32 matches, 100.0%; `git diff --check` clean. Vitest emitted the pre-existing node-cron sourcemap warning (missing source files) and exited 0.
