# Core final validation

Date: 2026-09-11 (Australia/Sydney). Track: PT-030 / S8. This report records
final local compatibility evidence against the compiled TypeScript build after
source and test edits froze. The fixture
uses a temporary `HOME`, two temporary YAML profiles, a local fake
OpenAI-compatible HTTP/SSE provider, and no user credentials or paid inference.

The fixture is opt-in so the ordinary root suite cannot accidentally exercise a
stale build. The final invocation was run immediately after `pnpm build`; it launches
`node dist/src/server/index.js`, checks that `dist/src/server/index.js` is at
least as new as every `src/**/*.ts` file, and checks the compiled startup marker.

## Mounted fixture

Command:

```text
CORE_FINAL_BUILD_FIXTURE=1 pnpm exec vitest run tests/core-final-build-validation.test.ts
```

Result: **passed, 1 file / 3 tests**.

Coverage:

- Two users and profiles: cross-user `attach` returns the scoped not-found
  error; observer mutation is rejected; explicit future cursor requests a gap
  snapshot.
- Runtime recovery: 270 mounted `profiles_list` events overflow the retained
  tail; a stale cursor returns a gap snapshot with bounded events.
- Human decisions: repeated approval and input responses return correlated
  acknowledgements while the fake provider executes each continuation once;
  stale response IDs are rejected.
- Provider path: mounted model discovery reports unknown API-key effort,
  invalid explicit effort is rejected atomically, default selection is
  acknowledged, and the outgoing fake-provider payload omits
  `reasoning_effort`.

The unguarded command is intentionally skipped: `pnpm exec vitest run
tests/core-final-build-validation.test.ts` reports **1 skipped file / 3 skipped
tests** and performs no temporary fixture setup.

An earlier coordinated-state attempt ran `pnpm build` while the provider audit
patch was between source and test updates and failed with
`tests/provider/codex-adapter.test.ts(32,118): error TS2353: Object literal may
only specify known properties, and 'effortCapability' does not exist in type
'CodexAdapterOptions'.` The subsequent `pnpm build` completed successfully
after that source/test state settled; the passing fixture above uses that fresh
build.

## Compatibility gates

These checks passed on the frozen working tree:

| Check | Result |
|---|---|
| `pnpm build` | Pass; TypeScript emitted `dist/` |
| `pnpm typecheck` | Pass |
| `pnpm exec tsc --noEmit` | Pass |
| `pnpm --filter harness-studio typecheck` | Pass |
| `pnpm --filter harness-web typecheck` | Pass |
| `node scripts/gen-web-protocol.mjs --check` | Pass; no output |
| `bash scripts/check-boundary.sh` | Pass: `Boundary guard passed.` |
| `git diff --check` | Pass; no whitespace errors |
| `cd tui && GOCACHE=/tmp/base-go-cache go test ./...` | Pass; 7 packages (`harness-tui`, `internal/prefs`, `internal/protocol`, `internal/server`, `internal/setup`, `internal/ui`, `internal/ws`) |
| `pnpm test -- --maxWorkers=1` | Pass; 170 files / 966 tests, 1 skipped file / 3 skipped tests |

`pnpm test -- --maxWorkers=1` emitted one existing node-cron sourcemap warning about missing
source files; it did not fail the run. The opt-in compiled fixture passed 1 file
/ 3 tests immediately after the final build. Fixture teardown closed the fake
provider and harness; `ps ax | rg '[d]ist/src/server/index.js'` found no
remaining compiled fixture process afterward.

## Delivery and remaining gates

No commit, push, release, deployment, provider account change, or client source
edit was made for this validation. Web and Studio checks are compatibility
checks only. Live provider entitlement/quality/billing, Codex OAuth, physical
device/audio, Windows installer/runtime, and client adoption remain separate
acceptance gates.
