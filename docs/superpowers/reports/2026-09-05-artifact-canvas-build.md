# R1/R10 artifact and Canvas build

## Scope

Implemented owned artifact recipes, Canvas lineage and refresh controls, SVG widget validation/rendering, export provenance metadata, and dedicated browser fixture pages. Shared server, loop, trigger, protocol, and main application seams remain lead-owned.

## Requirement coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| Artifact recipe stores profile/tool/code refs, parameters, dependencies and provenance | PASS in owned store | ArtifactRecipe, promoteArtifact, persisted recipe test |
| Explicit promotion creates owned persistent recipe | PASS in owned UI/store | Canvas promote callback and ArtifactStore.save; browser fixture supplies persisted recipe |
| Deterministic unchanged probe performs zero generation calls | PASS | artifact-canvas-build.test.ts generation spy remains at zero for unchanged cursor |
| Saved recipe runtime resolves real file dependencies and invokes gated generator | PASS in owned adapter | `ArtifactStore.refreshRuntime` test changes a temp JSON source, passes stored tool/code/parameters, and ignores caller payload/cursor by API shape |
| Changed source coalesces into one refresh/version | PASS | Concurrent refreshes share one promise and create one version |
| Failure retains last-good payload and marks stale | PASS | Unit test plus browser refresh failure after successful refresh |
| Restart retains recipe/version | PASS | Store re-instantiation test and browser reload assertion |
| Version compare reports actual payload change | PASS | compareVersions test |
| Canvas records real session/tool/code lineage | PASS in owned UI | Missing refs remain unavailable; no fabricated IDs |
| Refresh button requires persisted recipe | PASS | Canvas renders refresh only when recipeId exists |
| Exports carry source/version/freshness metadata | PASS in owned export helpers | SVG metadata, PDF source line, PNG source serialization use artifactExportMetadata |
| Heatmap, box plot and correlation matrix render real SVG | PASS | /widgets browser fixture and widget unit tests |
| Missing/invalid chart values remain explicit | PASS | Null cells render as missing; non-finite/out-of-range values produce alerts |

## Verification

Commands run from repository root:

    pnpm vitest run tests/artifact-canvas-build.test.ts tests/verifiable-work.test.ts
      PASS (2 files, 15 tests)
    pnpm --filter harness-web test
      PASS (23 files, 61 tests)
    pnpm typecheck && pnpm --filter harness-web typecheck
      PASS
    pnpm exec playwright test e2e/artifact-canvas.spec.ts
      PASS (1 test)
    pnpm exec playwright test e2e/widgets.spec.ts
      PASS (1 test)
    HARNESS_PORT=7444 HARNESS_PROFILE=coding pnpm dev:server
      PASS: mounted REST recipe flow (POST saved recipe, refresh source {2}->v2,
      unchanged refresh keeps v2, source {4}->v3, deleted source returns stale
      while retaining v3)
    NEXT_PUBLIC_HARNESS_HTTP_URL=http://127.0.0.1:7444 pnpm exec playwright test e2e/artifact-canvas-runtime.spec.ts
      PASS (1 test): actual mounted browser loaded saved recipe, pinned it, refreshed
      source to {value:6}, reloaded persisted last-good, deleted source, and retained
      last-good payload while showing stale.
    pnpm --filter harness-web web:e2e
      PASS (7 tests): clean global setup owns fixture harness on port 7444, seeds
      saved recipe/source, runs mounted runtime browser flow, and tears down all
      test state; replay, evaluation, Canvas, widgets, and surface escape checks pass.

Browser evidence:

- web/test-results/r10-canvas-stale-retention.png: pin real lineage, refresh to version 2, reload, fail refresh, retain version 2 and show stale.
- web/test-results/r10-canvas-runtime-stale.png: mounted REST runtime refresh, reload persistence, and source deletion stale retention.
- web/test-results/r1-visual-widgets.png: actual heatmap, box plot, and correlation SVGs with labels and missing cell.

The runtime test setup is `web/e2e/global-setup.ts`; it owns the temporary coding-profile server, source file, user-scoped recipe, and teardown cleanup. No manual server prerequisite remains.

Existing Next/Pyodide dynamic dependency warnings and standalone next start warning remain during Playwright startup.

## Integration instructions

Use ArtifactStore.refreshRuntime(id, { resolveDependency, execute, approval, allowEffects, taintSources, budget, signal }) for production recipe execution. The default file resolver hashes owned `file:` dependency contents; the injected execute callback receives stored tool/code/parameters and resolved snapshots. It coalesces concurrent calls by recipe ID, skips generation when the aggregate source cursor is unchanged, persists the returned recipe through ArtifactStore.save, and retains last_good on generator failure. Use compareVersions for version diffs. Web callers should pass actual source_session_id, source_tool_call_id, source_code_id, and generating tool fields; Canvas disables pin/promote when required lineage is absent.

## Remaining gaps

Lead-mounted REST refresh resolves the saved recipe through `ArtifactStore.refreshRuntime`; caller payload/cursor are ignored. REST emits allowlisted CORS headers and handles OPTIONS, enabling the mounted browser acceptance above. Normal agent-loop artifacts now carry session/tool-call lineage from the real loop seam, and promotion accepts the emitted `source_tool_name`/`source_code_id` fields or persisted `generating_tool`/`code_ref` equivalents. Artifacts without authenticated source lineage remain intentionally unpromotable.
