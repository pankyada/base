# R9 correction lifecycle acceptance

## Scope

Route-level acceptance for operator correction proposals, persisted diffs, evaluation gating, explicit promotion, stale-base protection, rollback, and untrusted correction-origin handling. Test uses an isolated in-process REST handler and a unique user-scoped artifact directory; no production files changed.

## Coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| Explicit operator correction creates scoped reviewable diff | `POST /corrections?user=...`; persisted JSON inspected for scope, mission, rationale, before/after, regression IDs, operator source | PASS |
| Incomplete evaluation does not pass | `POST /corrections/:id/evaluate` with `complete:false`; status remains `unevaluated` | PASS |
| Failed evaluation blocks promotion | `applyEvaluation(...failed...)` then `promoteCorrection`; rejects `only a passed correction can be promoted` | PASS |
| Passing evaluation still requires explicit operator action | REST evaluate only changes status; separate REST promote request required | PASS |
| Stale base rejects | `promoteCorrection(passed, changed base)` rejects `stale correction base hash` | PASS |
| Promotion writes version/history | REST promote returns `status: promoted` and `previous_content` | PASS |
| Rollback restores previous content | `rollbackCorrection(promoted, new)` returns old content and `rolled_back` proposal | PASS helper; REST route missing |
| Tool-origin text cannot impersonate operator | REST proposal with `source: tool` expected rejection | **FAIL: current route returns 201 and normalizes source to operator** |
| Persisted rollback endpoint | `POST /corrections/:id/rollback` expected 200 after promotion | **FAIL: current route returns 404** |

## Verification

Command:

    pnpm vitest run tests/r9-correction-acceptance.test.ts

Result: 1 passing lifecycle test; 2 failing acceptance tests exposing the two gaps above. Failure details are deterministic and isolated:

    rejects a tool-origin correction from impersonating an operator
      expected HTTP 400, received 201
    exposes explicit rollback route for persisted promoted version
      expected HTTP 200, received 404

Existing helper coverage remains green in `tests/verifiable-work.test.ts`, but it does not cover REST source validation or persisted rollback routing.

## Lead integration requests

1. In `src/server/rest.ts`, pass/validate `source` in the correction POST body and reject any value other than explicit `operator` before persistence. Do not infer operator authority from tool text.
2. Add a persisted rollback route, e.g. `POST /corrections/:id/rollback`, loading the user-scoped proposal, requiring `current`, calling `rollbackCorrection`, saving the returned proposal, and returning restored content plus proposal metadata.
3. Preserve non-2xx JSON errors for stale-base and invalid lifecycle transitions rather than allowing thrown route errors to close the connection.

No R9 completion claim until both failing acceptance tests pass.
