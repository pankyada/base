# Context projection

The session transcript is an append-only ledger. Every provider request gets a fresh projection, so context management never deletes or rewrites `session.messages`.

## Bands

The projection is ordered as:

1. Prefix — system prompt plus explicit pins.
2. Digest — optional earlier-session digest.
3. Live — the recent ledger tail.

The prefix is capped by `pin_budget`; the digest is regenerated from ledger turns rather than summarised from an earlier digest. Cache markers are optional and disabled by default.

## Decay ladder

Older tool results first become short elision handles. Their original role, position, and `tool_call_id` remain intact. The model can call `ContextRestore` to retrieve the complete stored result. If elision cannot fit the request, the projection folds only complete turns into the digest, then drops oldest turns as a final termination backstop.

Assistant and user messages are not elided. The configured `tail_turns` remain verbatim whenever the budget permits.

## Pins and memory

The `Skill` tool explicitly pins the loaded `SKILL.md` body. Pins are keyed, idempotent, and rendered in insertion order. Digest responses may include durable facts; those facts are written to the current `project` memory scope.

## Configuration

```yaml
context:
  max_tokens: 100000
  high_water: 0.80
  low_water: 0.45
  tail_turns: 3
  pin_budget: 0.25
  digest_model_id: gpt-5.4-mini
  cache: false
```

`context_window: { max_tokens, model_id }` remains accepted as a deprecated alias for `context.max_tokens` and `context.digest_model_id`.

The estimator starts with the existing JSON-size heuristic and self-calibrates against provider `prompt_tokens`. Telemetry records estimated and actual prompt sizes, calibration ratio, elision, digest, restore, and cache-read measurements.

## Cache measurement

The Anthropic OpenAI-compatible endpoint accepted the marked requests but returned no cache-read token field in a two-call live probe on 2026-08-01. `context.cache` therefore remains off by default; a native Anthropic path is needed before claiming a cache saving.
