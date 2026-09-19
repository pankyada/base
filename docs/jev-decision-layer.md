# Jev decision layer

Base can use TypeSafe Jev for typed semantic judgments alongside its main model. The layer is profile-owned and off by default. Start with `shadow`: it spends decision tokens and records bounded telemetry, while keeping the normal context and execution behavior. Thresholds remain provisional; [the four-case live smoke](superpowers/reports/2026-09-19-jev-live-smoke.md) is integration evidence, not production calibration.

This page describes configuration and policy. Use [PRODUCT_STATE.md](PRODUCT_STATE.md) for current implementation and acceptance; [the specification](superpowers/specs/2026-09-19-jev-decision-layer-spec.md) defines required behavior.

## Configure a profile

Omit `decision_layer` to retain existing behavior. An explicit disabled block is also valid:

```yaml
decision_layer:
  enabled: false
```

Merge the following block into an existing profile. Make `TYPESAFE_API_KEY` available to the Base server through its existing environment configuration; the YAML stores only the variable name. `allow_remote_state` explicitly permits bounded task, candidate and source-evidence data to leave Base for the configured endpoint. Do not enable it on a profile whose data must remain local.

```yaml
decision_layer:
  enabled: true
  provider: jev
  endpoint: https://api.typesafe.ai/v1/systemone
  model: jev-1.13.0
  api_key_env: TYPESAFE_API_KEY
  allow_remote_state: true
  config_revision: jev-shadow-v1
  applicability_threshold: 0.5
  features:
    capability_selection: shadow
    memory_capture: shadow
    memory_recall: shadow
    memory_retention: shadow
    workflow_routing: shadow
    compaction: shadow
    result_verification: shadow
    failure_guidance: shadow
  limits:
    max_calls: 8
    max_request_bytes: 256000
    max_response_bytes: 256000
    max_input_tokens: 64000
    max_output_tokens: 16000
    max_wall_ms: 30000
    max_cost_usd: 0.05
  price:
    input_usd_per_million_tokens: 0.042
    output_usd_per_million_tokens: 0
  retry:
    max_attempts: 2
    base_delay_ms: 50
    max_delay_ms: 1000
  cache:
    enabled: true
    ttl_ms: 300000
    max_entries: 256
```

The price values match the pinned model's accounting configuration used for the 2026-09-19 smoke. They are explicit operator inputs, not a live pricing lookup or provider credit balance. Recheck vendor pricing before changing models. Missing pricing when cost admission needs it produces `unknown_cost`; it does not mean free inference. Decision calls also remain subject to the parent run's budgets and existing dispatch gates.

Each feature accepts `disabled`, `shadow`, or `enforce`; omitted features are disabled. To apply a feature after reviewing its task-specific results, change that feature to `enforce`. Keep the rest in shadow or disabled. Changing `config_revision` invalidates the rubric/config cache identity. `workflow_routing` does not enable workflows: the existing `workflow.enabled`, playbook and fixed routing settings still control that path.

## What each feature controls

| Feature | Enforce behavior and boundary |
|---|---|
| `capability_selection` | Narrows optional skill context and provider tool schemas. Explicit skills, required controls and capability discovery remain available. Tool execution still uses the normal permitted registry and gates. |
| `memory_capture` | Checks automatic digest/reflection candidates against actual source evidence before promotion. A supported explicit user save is not discarded because salience is low or Jev is unavailable. |
| `memory_recall` | Selects from structurally scoped and temporally valid memory candidates for current context. Imminent and explicitly protected material retain priority; direct memory access remains possible. |
| `memory_retention` | Enables the explicit `MemoryReview` retention operation. Archival is reversible metadata; original content, evidence and history remain. A semantic score never authorizes deletion. |
| `workflow_routing` | Advises among existing task classes and stage intensities; configured playbooks, stage clamps and specialist definitions remain authoritative. |
| `compaction` | Selects source-bound supplemental preservation within the remaining context budget. Explicit pins and valid tool-call/result groups take priority. |
| `result_verification` | Adds bounded advice about whether real tool output answers the task. It cannot change the executor's result, `ok` flag or provenance. |
| `failure_guidance` | Advises retry, rediscovery, escalation or stop after an observed failure. It does not replay effects or override denial, parked approval, cancellation or budget exhaustion. |

Retention review runs through the profile-gated, write-effect `MemoryReview` tool,
not as a side effect of `MemoryList`. The main model can request a bounded review
through the normal tool gates:

```json
{"name":"MemoryReview","arguments":{"scope":"user"}}
```

Structured-claim conflict checks belong to the memory write path; unresolved
claims must remain preserved. PT-068 implementation and automated acceptance of
recall/conflict hooks are complete; exhaustive live/user acceptance and broader
calibration remain separate in PT-069.

Archived memories remain accessible by stable scope/key. Where the memory provider supports reversible retention, the main model can restore one through the normal gated tool path:

```json
{"name":"MemoryRestore","arguments":{"scope":"user","key":"project-convention"}}
```

This is a tool-call example, not a shell command. A provider without restore support reports that limitation; restore does not recover deleted records.

## Failure behavior

| Symptom | Meaning / action |
|---|---|
| Profile validation rejects configuration | Enabled configuration needs `allow_remote_state: true`, a model ID and `api_key_env`. Feature names and modes are strict; use `disabled`, not `off`. |
| `missing_credentials` | The named environment variable is unavailable to the server process. Correct that process's environment; never paste the key into YAML or logs. |
| `unknown_cost` | Required cost pricing is missing. Configure both price fields for the chosen model. |
| `request_limit`, `byte_limit`, `token_limit`, `budget_exhausted` | A local admission bound prevented or stopped inference. Inspect the bounded counters and run budget before raising limits. |
| `http_error`, `rate_limited`, `overloaded`, `network_error`, `malformed_response` | The decision was unavailable. Ordinary selection failures retain baseline/recovery behavior; automatic memory promotion stays conservative. HTTP retries are bounded. |
| Cancellation, deadline or policy control outcome | Control failure is propagated; it is not converted into permission to proceed. |
| Capability omitted | Use `CapabilityDiscovery` through the main model to recover permitted candidates. Selection never grants an ACL-denied capability. |
| Scores look surprising | Review a small safe labeled corpus and actual task outcomes. `0.5` is a provisional threshold, not a production accuracy guarantee. |

Decision telemetry is intended for model/outcome/reason, timing, bytes, token usage and cost. It must not contain raw task text, memory source excerpts, tool bodies, provider state or secrets. Bounded redaction is not a guarantee that every arbitrary secret in prose can be recognized; choose eligible profiles accordingly.

## Reproduce evaluation

Run from the repository root. Offline evaluation uses injected responses; it makes no paid TypeSafe request:

```sh
pnpm exec tsx scripts/evaluate-decisions.ts --json
```

The optional live command uses `TYPESAFE_API_KEY` from the environment and sends the fixed synthetic public-safe corpus to TypeSafe:

```sh
pnpm exec tsx scripts/evaluate-decisions.ts --live --json
```

The script reads `tests/fixtures/decision-evaluation.json`; it currently has no `--fixture` option. It pins `jev-1.13.0`, caps calls to the corpus size and uses a `$0.05` configured decision budget. The report covers capability choices and source-grounded candidate judgments; it does not execute those tools or persist those memories. Offline success checks code behavior, while this tiny live corpus checks connectivity and a few semantic examples. Neither establishes full task success or production calibration. Keep PT-069 calibration and any deployment acceptance separate.

To roll back selection/advice, disable `decision_layer` or its individual features. Existing history and pins remain. Retention markers are reversible; disabling the layer is not a request to erase memories or bypass normal restore policy.
