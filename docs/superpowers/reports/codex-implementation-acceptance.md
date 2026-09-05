# Codex integration implementation acceptance

Date: 2026-09-06 (Australia/Sydney)
Status: implemented locally as experimental opt-in; automated validation passed; live acceptance pending.

User requested `gpt-5.6-luna` with high reasoning for implementation. Luna implemented bounded milestones; the parent reviewed and corrected credential lifecycle, stream validation, execution gating, continuation handling, invocation accounting, and child budgets. No production login, credential import, deployment, push, or commit occurred.

The starting checkout was already substantially dirty at HEAD `13c9ce0fdfe8f414518faba36e4443631dd979d4`. Existing unrelated work was preserved. This report describes the local working tree, not a released binary. Baseline evidence: [baseline](codex-baseline.md).

## Implemented behavior

- API keys remain default when `model.auth` is absent. Existing endpoint/environment handling and profile selection remain. Explicit `codex_oauth` profiles reject API-key endpoint fields. No Claude subscription work.
- Browser PKCE and device authorization commands, private Base credential storage, atomic replacement, cross-process serialization, bounded refresh, cancellation, logout tombstones, and redacted status/errors.
- Fixed Codex Responses transport with flat function calls/results, streamed event validation, bounded buffers, UTF-8 validation, argument/schema validation, refusal/incomplete/EOF handling, and no execution before a valid terminal result.
- Account/model-bound continuation on its owning assistant turn; restart persistence; safe completed-history translation after switching; stale pending-tool rejection; metadata excluded from API requests, message readers, summaries, replay exports, and branches.
- Provider seam across main loop, helpers, workflow stages/previews, maintenance actions, REST runtime, delegation, and artifact generation. Base retains tool ACL, approval, hooks, provenance, and execution.
- Shared root inference-attempt limits, cancellation/deadlines, bounded explicit-rejection retries, one authentication replay, local Codex concurrency limit, and conservative accounting for uncertain accepted generations.
- Child usage merges on failure as well as success. Budget absorption prevents counting merged child spend twice. API-key child retries use the same root attempt ledger; SDK retries are disabled for accounted requests so they cannot run invisibly behind that ledger.
- API-equivalent subscription estimates, API estimate subtotals, mixed/legacy attribution, unknown billed cost, and cached/reasoning/attempt metadata through saved usage and existing web/TUI displays. REST results retain metadata.
- Child stats carry originating billing metadata; connection usage flushes across profile changes and after aborted-call finalization. Active runs and maintenance block profile/model switching.
- Existing init/doctor flow extended; no shipped profile silently switched. Disable control: `HARNESS_DISABLE_CODEX_OAUTH=1`.

Initial Codex catalog contains `gpt-5.4-mini` with source-derived capabilities. Account entitlement and backend acceptance remain unverified. Source evidence and pinned OpenCode links: [compatibility report](codex-compatibility.md). No new npm dependency was required for this integration.

## Final automated validation

| Check | Result |
|---|---|
| Root `pnpm test` | **156 files / 887 tests passed** |
| Root `pnpm typecheck` | Passed |
| Root `pnpm build` | Passed |
| Boundary guard | Passed |
| Generated web/Studio protocol freshness | Passed |
| Web typecheck | Passed |
| Web tests | **23 files / 62 tests passed** |
| Web production build | Passed |
| Go `GOCACHE=/tmp/base-go-cache go test ./...` | Six tested packages passed; WebSocket package has no test files |
| Studio typecheck | Passed |
| `git diff --check` | Passed |
| Codex mock probe | Three requests; text, tool round trip, and continuation passed; billing deliberately unverified |

Root suite baseline was 138 files / 792 tests. Earlier review failures were corrected; an intermediate protocol freshness failure occurred while generation inputs were still being edited. Final results above supersede those intermediate runs. Existing node-cron sourcemap and web bundler warnings did not fail the checks.

Focused evidence includes malformed credential replacement preservation; callback state/replay validation; stalled auth-body deadlines; three-process lock serialization; refresh rotation/account generation; fragmented and malformed SSE; no malformed/stale tool execution; uncertainty/cancellation budgets; mixed child accounting; continuation save/reload/public-summary filtering; API option preservation; and replay privacy.

`tests/provider/codex-runtime.test.ts` exercises the actual one-shot server runtime, Base loop, Delegate tool, child profile, and Responses adapter against a fake backend. API client creation throws if attempted. Three Codex requests complete, and root plus delegated usage reaches the saved ledger exactly once. This is an integration test with mocked inference, not live model acceptance.

Logs from this local run reside in `/tmp/base-codex-parent-review/`, including `root-final.log`, `root-build-final.log`, `web-build-final.log`, `go-final.log`, and `mock-probe-final.json`. These temporary logs are not release artifacts.

## Remaining acceptance and limitations

- A12 remains pending: real browser/device login, account/client-registration acceptance, real text/tool/multi-turn/restart behavior, and provider-side usage attribution. Mocks cannot establish these.
- No live credentials or live encrypted reasoning were used. Tests validate refresh with synthetic credentials; real issuer expiry/refresh behavior remains live acceptance.
- Windows filesystem ACL, process-lock, and browser launch behavior remain unverified. Go tests ran on this Mac. No separate Linux host acceptance or visual browser acceptance was performed.
- Model catalog expansion requires new capability evidence and account testing. Source-derived support is not a subscription entitlement promise.
- API-equivalent estimates are conservative budget controls, not charges. Interrupted accepted requests without usage may reserve the entire validated maximum output bound.
- Credential lock recovery deliberately fails closed if a stale recovery marker cannot be safely resolved; manual inspection may be required after a process crash in that narrow recovery window.
- Personal use does not itself establish third-party client authorization. Compatibility with the shared upstream client registration is a live gate.

The specification's full acceptance matrix remains the release criterion; this report does not replace individual live/platform gates with passing unit tests. No claim of a fully accepted subscription release is made.

## Operator entry point

See [Codex authentication guide](../../CODEX_AUTH.md). In this checkout the built CLI can be invoked with `node dist/src/cli/index.js`; an already installed `harness` command may still point to an older installation. Login stores credentials only and does not change a profile. Use the existing init/profile flow to select Codex explicitly.

Rollback remains additive: disable the transport, restore an API-key model block through the existing confirmed profile flow, and optionally log out of Base. Existing keys and session history remain intact. Backward-binary compatibility has not been exercised on a deployed installation.
