# Jev synthetic live smoke report

Date: 2026-09-19

This is a bounded integration smoke against the TypeSafe System One endpoint. It is not production calibration or an accuracy claim. The request corpus is synthetic and public-safe: `base-synthetic-public-v3` from `tests/fixtures/decision-evaluation.json`.

Configuration used:

- Model: `jev-1.13.0`
- Applicability and promotion threshold: `0.5` (fixed before the run)
- Input price configured for accounting: `$0.042` per million tokens; output price: `$0`
- Maximum calls: `4`; maximum configured run cost: `$0.05`
- Remote state consent: explicitly enabled for this smoke only
- Credential: resolved from the `TYPESAFE_API_KEY` environment variable; the value was not printed, persisted, or included in this report

Observed run totals:

- Requests: 4
- Input tokens: 2,518
- Output tokens: 485
- Accounted cost: `$0.000105756`
- Latency: 706 ms, 570 ms, 281 ms, 293 ms

Per-case results:

| Case | Expected applicable capabilities | Selected capabilities | Memory promotion | Result |
|---|---|---|---|---|
| `durable-preference` | `memory-write` | `memory-write`, `memory-read` | promoted | one extra read candidate |
| `temporary-status` | `memory-read` | `memory-read` | not promoted | expected |
| `unsupported-deployment-assertion` | `read-release-log`, `bash-release-smoke` | `read-release-log`, `bash-release-smoke` | not promoted | expected |
| `no-match` | none | none | not promoted | expected |

Aggregate scores against the fixed synthetic labels were capability precision `0.80`, capability recall `1.00`, unsupported memory promotions `0`, memory promotion precision `1.00`, and memory promotion recall `1.00`.

The scores describe this four-case synthetic smoke only. They do not establish production quality, calibrated thresholds, task success, latency savings, or memory truthfulness. The memory labels include explicit synthetic source excerpts, source roles, scopes, and taint values so the adapter receives source-grounded state; the smoke does not persist a memory record or execute a capability.

Earlier exploratory runs used abstract capability labels and are superseded by this report: the first corpus was not retained as evidence, and the second corpus was replaced because its capability labels did not map to concrete actions. No threshold was tuned after the v3 run.
