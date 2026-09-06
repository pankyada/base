# Model-aware effort selection

Date: 2026-09-06
Status: Draft for review; not implemented.
Scope assumption: Codex first, then OpenAI API and Anthropic. Provider sequencing and proposed UX remain review items. This spec is the implementation source of truth once approved.

## Outcome

An operator selects a model and its supported effort in setup or the existing runtime MODEL picker. The server validates the pair and the provider receives the selected setting. Reconnecting restores an acknowledged selection. Unsupported or unknown capability never becomes an invented effort menu.

Prioritize current models returned by the provider. Do not remove older models, infer support from a version/name prefix, or maintain a second independently curated UI catalog.

## Evidence and present gaps

Live authenticated Codex catalog query on 2026-09-06, using catalog compatibility version 0.153.4, returned:

| Model | Advertised effort values | Provider default |
| --- | --- | --- |
| gpt-6-astra | low, medium, high, xhigh, max, ultra | medium |
| gpt-5.6-sol | low, medium, high, xhigh, max, ultra | low |
| gpt-5.6-terra | low, medium, high, xhigh, max, ultra | medium |
| gpt-5.6-luna | low, medium, high, xhigh, max | medium |
| gpt-5.5 | low, medium, high, xhigh | medium |
| gpt-5.4-mini | low, medium, high, xhigh | medium |
| gpt-5.3-codex-spark | low, medium, high, xhigh | high |

All seven currently selectable Codex models advertise effort. This is an account/transport-specific snapshot, not a permanent global allowlist or evidence that every level works through Base. Catalog descriptions associate ultra with automatic task delegation; inspect its protocol and tool-ownership requirements before enabling it. Base must not claim support solely because a string is advertised.

Official API evidence differs: [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) documents low through max, and [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) documents none through max. Subscription and API capability records must remain separate.

[Anthropic effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort) specifies `output_config.effort`, with model-specific levels and thinking constraints. Newer Claude models support effort, but not identical options. Base currently uses an OpenAI-compatible Chat Completions adapter for API-key providers; native Anthropic support cannot be inferred from that adapter.

Current implementation:

- `src/models/discovery.ts` retains IDs but discards supported/default effort metadata.
- `src/provider/codex/models.ts` guesses generic effort values for unknown GPT IDs and labels that guess live. Replace this inference for effort validation; do not expand it to accommodate max/ultra.
- `src/profiles/schema.ts` only has `model.codex.reasoning_effort`; validation consults the guessed/static table.
- `src/provider/factory.ts`, `src/loop/agent-loop.ts`, and Codex serialization partially carry effort already.
- `src/provider/api-key.ts` writes `reasoning_effort` and sometimes forces none for tool calls. Reconcile this behavior with actual endpoint contracts before enabling API effort selection.
- Runtime WS, Go preferences/picker, and web protocol expose model selection without effort.

## Capability contract

Extend shared `ModelInfo` with optional `effort` metadata. Absence from an old server means unknown, not unsupported.

```ts
interface EffortCapability {
  status: 'supported' | 'unsupported' | 'unknown';
  options: Array<{
    value: string;
    label: string;
    description?: string;
    selectable: boolean;
    unavailable_reason?: string;
  }>;
  provider_default?: string;
  source: 'live' | 'documented' | 'cache';
  checked_at: string;
  stale: boolean;
}
```

Use validated, bounded strings rather than a frozen low/medium/high enum. Retain provider ordering. Values remain provider-native; no conversion of xhigh to max or none to default. Validate incoming metadata, deduplicate values, bound length/count, and discard control characters. Missing/malformed capability is unknown.

Key records by transport + normalized endpoint + account identity + model ID. Never put credentials or raw account identifiers on the wire or in UI preferences. Use a server-issued opaque scope for client persistence. Invalidate account-scoped data on logout/account replacement. Prefer live metadata; allow a labeled, same-scope last-good cache with a five-minute freshness interval. Never upgrade stale/unknown data to live. Refresh before accepting a new explicit choice against stale data; unavailable refresh rejects the change with current state unchanged.

Distinguish provider-advertised from Base-selectable options. An adapter compatibility record may disable advertised values with an explanation. Ultra remains visible but disabled until its wire behavior, tool ownership, cancellation and budget behavior are validated. Documented fallbacks must cite exact model/transport evidence and date. No wildcard model-family inference.

## Selection semantics

- `default` is a UI choice represented as null on the wire. It means omit the effort parameter and let the provider decide. Display the advertised default when known.
- `none` is a literal provider option and only appears if supported for this exact transport/model.
- Initial state uses profile effort when configured and valid, otherwise provider default. Legacy invalid configuration produces a diagnostic; do not silently reinterpret it.
- Model and effort apply atomically. Changing model chooses its saved valid setting, then its applicable profile default, then provider default. Never carry an incompatible effort from another model. If a saved value disappeared, show the reset reason before applying the proposed pair.
- Invalid explicit pair is rejected without changing either field. No silent clamping or retry with a lower effort.
- Reject changes during an active turn, pending approval, maintenance, or from an observer. Recheck after any async discovery. Ignore stale acknowledgments/catalogs after a profile or account switch.
- Capture effective model/effort at turn start; all root-turn model calls use that snapshot. Retries retain it. Changes affect future turns only.
- Helpers, safety classification, digest, improvement and delegated profiles retain their own configuration. A parent high/max setting must not silently spread to helper models. Workflow/fallback model changes resolve capabilities independently and report the effective setting.
- Existing run deadlines, token/call budgets, approvals and billing mode remain authoritative. Effort does not automatically enlarge budgets or authorize provider-managed tools/delegation.

## Configuration and protocol

Add optional `model.reasoning_effort` to both profile branches. Preserve `model.codex.reasoning_effort` as a deprecated alias; equal values are accepted, conflicting values rejected. Load-time schema validates syntax without requiring network. Runtime validates capability before explicit use. Existing profiles remain unchanged until a reviewed edit; setup diff includes model and effort.

Extend `set_model` with optional `effort: string | null` and request ID. An omitted field retains legacy behavior for old clients; for a new model resolve its default rather than copying the previous model's effort. New clients always send the complete pair. Extend `models`, `model_changed`, and initial/session state with requested effort, resolved/display default, selection source, opaque provider scope and request ID as appropriate. Runtime acknowledgment is the only authority for UI state and persistence.

Advertise `model_effort_selection` in server capabilities. Existing protocol v4 messages remain valid; old clients ignore additive fields. New clients connected to old servers show the control disabled and never save an unacknowledged effort. If implementation requires incompatible required fields, explicitly version the protocol and retain the old behavior branch.

Persist acknowledged preferences by server/provider scope + profile + model in `tui.json`; preserve `ModelByProfile` migration. Reconnect waits for capabilities, then sends one validated model/effort pair. Store effective effort in turn/run metadata so history can distinguish selected settings. Do not store chain-of-thought or infer effort from response text. Headless profile runs use the same resolver without introducing a separate selector.

## Proposed UX (approval required before UI implementation)

Keep existing MODEL panel. Selecting a model opens a compact effort subpanel within that panel, with Default plus model-specific choices and a short description. Enter applies the pair; Escape backs out without mutation. Existing outer-tab navigation remains intact; do not steal Tab from shared navigation. Show current model/effort in compact status text. Effort can be changed for the current model without selecting a different model.

Unsupported: “Effort unavailable for this model.” Unknown: “Effort support unknown; using provider default.” Loading/refresh/error states are explicit; never display a stale choice as accepted. Preserve long IDs, filtering, scrolling, resize handling, and keyboard-only operation. Reuse current theme/layout; no new top-level tab.

Setup asks effort immediately after model selection when supported, then includes it in the existing profile diff/confirmation. `--yes` does not invent a high-effort default; `--offline` only offers documented same-transport options. Runtime preference changes do not rewrite profile YAML. Web and readline CLI use the same server contract; staged delivery must label their availability separately.

## Provider phases

1. Codex: preserve live effort metadata; validate request serialization against those capabilities; remove effort guesses and alias conflicts. Prove root-turn propagation, tool continuation, reconnect and cancellation.
2. OpenAI API: document/test exact Chat Completions or explicitly selected Responses transport behavior. Audit forced-none behavior, sampling restrictions and token parameter names. Do not silently change billing mode or transport. If modern tool/effort combinations require Responses support, implement it as an explicit prerequisite with its own ADR and acceptance tests.
3. Anthropic: expose native effort only after the selected transport supports its exact payload and thinking constraints. A native Messages adapter requires separate explicit schema/ADR, streaming/tool-call translation and continuation tests. Until then show adapter-unavailable status, not an ineffective control. No Claude subscription scope.

## Acceptance gates

- Every current selectable Codex model exposes its actual advertised options/default; unsupported models expose no selectable literal values; unknown models remain honest.
- End-to-end setup and runtime selection produce the expected outgoing provider parameter, including omission for Default.
- Default versus none, ultra adapter gating, removed options, stale cache, offline mode, account replacement and custom IDs are covered.
- Profile/model/effort changes and saved restore cannot race or leak settings across provider scopes.
- Real deployed WebSocket list → select → acknowledged state → provider request is checked; setup-only evidence is insufficient.
- Go picker exercised for keyboard, every outer tab, filtering, resize, cancel, active-turn rejection and reconnect. Web/CLI parity tested when enabled.
- Mock tests prove serialization and state contracts. Small controlled live text and tool-continuation probes establish each enabled effort tier; catalog retrieval alone never marks inference support complete. Cap calls/output and record acceptance versus rejection separately from quality/billing.
- Full TypeScript suite, typecheck/build, boundary guard and Go suite pass before commits/release. Deployment verifies new server process, not only replacement binaries.

## Non-goals

Automatic effort optimization, benchmark-based defaults, manual reasoning-token budgets, verbosity controls, reasoning transcript display, blanket support for legacy models, and unrelated provider/auth rewrites.
