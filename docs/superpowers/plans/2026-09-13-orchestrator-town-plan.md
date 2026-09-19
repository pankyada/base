# Orchestrator town implementation plan

Date: 2026-09-13. Complexity: high. PT-052 implementation; PT-020 discovery. User now authorizes specification and build; earlier discovery checkpoints retain their historical meaning. This plan owns implementation sequencing and visual direction; the [Orchestrator town specification](../specs/2026-09-13-orchestrator-town-spec.md) owns wire contracts and acceptance. Its frozen HTTP/SSE contract governs implementation. No commit, release or deployment implied.

## Outcome and boundaries

Build `/town`: a real navigable simulated 3D medieval project landscape rooted at `~/Desktop/development`, with selectable project buildings, local boards, central hall instructions and event-backed workers/handoffs. Orchestrator assignment/start uses actual remaining provider subscription/API quota. Internal USD estimates are never presented as that quota. Implement the specification's deterministic policy for unavailable/stale quota; report external-provider acceptance honestly.

Reuse Web `Shell`, shared socket identity, `buildScopedUrl`, `RemoteData`, existing Core session/run lifecycle and approvals. Keep generic durable contracts in Core and visual coordinates in Web. No unrelated `/ops` redesign, authentication system, automatic merge/deployment, elaborate interiors or invented live activity.

## Art and interaction brief

The approved direction is a navigable medieval town with orbit, pan, tilt, zoom, town/building views, camera-facing labels, readable board side panels, return to centre, saved viewpoints and stable buildings while interacting. A fixed isometric image does not satisfy it. The following concrete treatment implements that direction.

- **Scene:** original low-poly hillside market town. Broad circular stone plaza, tall square town hall with slate gable and brass bell, modest timber-and-plaster workshops, scaffold poles for active milestones, narrow sandy roads, sparse angular trees. Projects keep distinct seeded roof/body proportions. Town hall remains recognisable from every side. Inactive/old repositories remain dormant offices; scaffold only an actual active task, never mere age. No photographic textures or large downloaded artwork.
- **Palette/materials:** muted moss ground `#61755a`, warm limestone `#d4bea0`, dark timber `#543e30`, slate roof `#344956`, clay accent `#a85f43`, brass selection `#e8bc67`. Matte faceted materials, soft daylight, gentle shadows. Use teal for working, amber plus question glyph for needs-user, rust plus failure glyph for failed, neutral gray for unknown. Status never relies only on color.
- **Hierarchy:** full available viewport scene. Compact top strip carries town name/root, connection/freshness and real quota status. Left collapsible project list/search provides reliable navigation. Right 360–420px board opens on selection; centre scene remains visible. Town hall board has instruction composer and Needs you/In motion/Delivered queues. Bottom compact camera controls carry Centre, zoom, views and control hint. No oversized prose/header or floating dashboard carpet.
- **Readable UI:** DOM typography and controls over the canvas, using existing sans-serif system fonts; dark ink and warm near-white panel surfaces. Selected project title, task state and next action lead. Paths, evidence, quota source/reset/window and agent details are secondary. Keep input text and draft state through board tab changes and scene updates.
- **Camera:** perspective camera, initial 45° field of view, target town plaza, roughly 45° elevation and diagonal azimuth. Fit discovered bounds with margin; restrict polar angle roughly 20–75° from vertical to prevent underground/horizon loss. Orbit left drag, pan right/modified drag, wheel zoom; provide DOM buttons and keyboard alternatives. Clicking selects without moving camera; Focus moves camera toward selected building. Distinguish drag from click. Saved views store position/target per user/root using the specification's settings contract; Centre always restores a valid overview.
- **Districts and attention:** group by stable root-relative parent path. Stable project IDs determine slot order within districts. Active work and needs-user projects occupy inner attention bands; last commit recency orders remaining projects into progressively outer bands. Never equate commit age with completion. Freeze layout during interaction and ordinary status refreshes; deliberate discovery refresh applies new ranking and reports the change. New arrivals take free slots. Selection must survive camera/layout changes.
- **Buildings/workers:** office remains standing while active feature scaffolding changes around it. Represent only known worker/task states; a motion cue may indicate a real running task, never successful progress by elapsed time. Question/handoff courier cue appears only for a corresponding event; persistent board entry survives animation. No rooftop task text requiring oblique reading. Roof-off interiors remain optional follow-up.
- **Small screens/accessibility:** at narrow widths, board becomes a bottom/stacked panel with a usable scene area and visible close button. Project list offers all primary selection/actions when WebGL unavailable. Reduced motion removes transitions and decorative motion, not information. Camera keyboard controls only intercept keys while scene control owns focus.

## Rendering choice and preparation

Add `three` to `web/package.json` and matching TypeScript declarations only if required by the selected package; pin a compatible resolved version in the lockfile. Current Web has Next 15/React 18 but no scene library. Three.js is justified by actual perspective geometry, picking and camera interaction. Use direct Three.js with `OrbitControls`; no React scene wrapper required. Load scene client-side; keep API/board state in React and scene instances behind a component boundary. Dispose controls, observers, frame callbacks, geometries/materials and renderer on unmount; pause unnecessary rendering in hidden tabs and cap device pixel ratio.

Official [OrbitControls documentation](https://threejs.org/docs/pages/OrbitControls.html) verifies camera orbit/dolly/pan, explicit addon import and updates after camera changes. Context7 tooling is unavailable in this session; official docs were read directly. Implementation must verify APIs against the installed version. Planner skill supplies phased task structure; existing authorized requirements supersede its generic clarification step.

## Contract handoff and work allocation

Implement `docs/superpowers/specs/2026-09-13-orchestrator-town-spec.md` PT-052. Web consumes the canonical project/task/message/quota DTOs through `/town/snapshot` and cursor SSE `/town/events`. Commands use the specified discovery, task, dispatch, message, acknowledgement and orchestrate endpoints. Render quota `available|unavailable|stale|exhausted|unsupported` explicitly; queued dispatch reasons are quota/dependency/workspace/concurrency. Handle snapshot resync and Git unknown/partial honestly. Follow final spec corrections over any preliminary planning wording.

No static meter or manual capacity field substitutes for live upstream quota. The Codex adapter compatibility spike and account-scope match are required evidence; unsupported integration holds automatic dispatch under the specification. Town hall instructions must invoke a real orchestrator run, which creates/dispatches actual worker runs. Task strings and visual fixtures are intermediate test inputs only.

Core and Web tasks below are independently decomposed. Current staffing assigns both to Luna `build_core`; execute them in dependency order without claiming parallel capacity or waiting for a separate UI agent. Design/planning owner remains available for visual review.

## Sprint 0 — Freeze contracts and baseline

Demo: agreed fixtures can describe the town without constructing a UI.

1. **P0.1 Specification handoff.** Terra finalizes project identity/discovery, durable tasks/messages, quota capability and gate, execution workspace and recovery rules, snapshot/event cursor, routes and errors. Inputs: discovery and current source inventory. Output: companion spec and tracker IDs. Dependencies: none. Validation: Core/Web implementers acknowledge identical contract; no duplicate hand-written wire definitions.
2. **P0.2 Baseline.** Implementation owner records initial dirty files and relevant tests/typechecks before changes; preserve existing unrelated work. Record failures without silently attributing them to this feature. Establish rollback diff/patch boundary before UI edits. Dependencies: none. Validation: baseline evidence recorded by owning agent.

## Sprint 1 — Core state and Web scene in parallel

Demo: Core can discover/read durable town state; Web can navigate a fixture town with honest fixture labeling.

1. **P1.1 Core registry/store.** Under the spec-selected Core modules, write failing tests for root discovery/nested repositories, stable identity, invalid/missing paths, scope separation, atomic persistence and restart. Implement only required registry/task/message state. Dependencies: P0.1. Validation: targeted tests prove no duplicate repos and no state loss.
2. **P1.2 Web adapter/reducer.** Add `web/lib/town*` and `web/tests/town*` as needed; test scope changes, stale replies, snapshot/replay reconciliation, unavailable reads and correlated command result before implementation. Use canonical contract imports/generated artifacts. Dependencies: P0.1; can run alongside P1.1. Validation: transport contract fixtures pass without canvas.
3. **P1.3 3D scene.** Add `web/app/town/page.tsx`, `web/app/town/town.css`, `web/components/town/TownScene.tsx` and small scene/layout modules. Add route to `web/components/chrome/Shell.tsx`. Implement approved art/camera/picking with fixture data passed through the same adapter boundary. Dependencies: P0.1 and adapter shape, not running Core. Validation: actual browser orbit/tilt changes visible perspective; pan/zoom/focus/Centre work; renderer cleanup and fallback checked.
4. **P1.4 Boards.** Add DOM town hall/project panels and list using tested adapter. Test draft preservation, keyboard selection, loading/empty/unknown/error states and command pending/receipt behavior. Dependencies: P1.2; independent of scene polish. Validation: component tests and narrow browser usability.

## Sprint 2 — Execution, quota and collaboration

Demo: known eligible quota starts a project task; questions route to town hall; insufficient/unknown/stale quota behaves exactly as specified.

1. **P2.1 Quota gate.** Core owner test-first implements provider/account quota capability, fresh windows/reset information, explicit unsupported/unknown states, sufficient-capacity evaluation and required concurrency handling. Reuse existing internal run limits separately. Dependencies: P1.1. Validation: eligible, exhausted, stale, unknown, provider failure and concurrent dispatch tests; no fabricated quota from spend estimates.
2. **P2.2 Project execution.** Test-first bind requested work to correct project workspace/profile and existing lifecycle. Implement spec-defined durable assignment, dispatch acknowledgement, error/cancel recovery and collision behavior. Dependencies: P2.1. Validation: real temporary project directories prove correct working directory; duplicate commands/retries cannot accidentally start duplicates.
3. **P2.3 Messages and questions.** Implement durable scoped handoffs/questions and reply correlation with canonical states. Dependencies: P1.1/P2.2. Validation: originating task gets one correlated answer, unrelated project cannot consume it, failure/retry/restart remains inspectable.
4. **P2.4 Connect live scene.** Replace fixture-only operation with scoped `GET /town/snapshot?after=` and `GET /town/events?after=` SSE; worker and courier cues derive from actual task/message state, boards show evidence and quota reasons. Dependencies: P2.2/P2.3; Web fixture work continues beforehand. Validation: scene, list and boards agree after reconnect and project selection changes.

## Sprint 3 — Integrated acceptance and closeout

Demo: real browser navigates discovered projects, submits instruction, sees dispatch or honest quota hold, follows worker state and completes question round trip; restart retains durable work and reports interruption truthfully.

1. **P3.1 Real integration fixture.** Use isolated temporary projects and deterministic provider/quota fixtures with the real server and production Web build. Test restart while task active, event gaps, expired quota, failed provider and duplicate dispatch. Validate actual storage and workspace effects, not only DOM stubs. Dependencies: Sprint 2.
2. **P3.2 Visual/browser acceptance.** Add `web/e2e/town.spec.ts` or equivalent. Check real 3D perspective from two azimuths and elevations, pan/zoom, project picking, readable labels/boards, saved views, Centre, stable layout during events, keyboard and narrow layout, unknown state, reconnect and no console errors. Record screenshots and inspect them. No screenshot-only claim of interaction acceptance.
3. **P3.3 Repository verification.** Run required Core/Web targeted suites, full `pnpm test`, root typecheck/build, Web test/typecheck/production build, protocol generator freshness and boundary check when touched. Run Go compatibility checks if shared protocol changes affect TUI. Run diff whitespace check. Record exact counts and failures. Dependencies: fixes complete; repeat only affected checks after new changes.
4. **P3.4 Evidence and tracker.** Owning agent updates PT-052 and linked discovery/implementation task rows, component state, roadmap and ADR as applicable. Separate implementation, fixture acceptance, actual provider quota/live agent acceptance and deployment. Any unavailable live provider integration stays an explicit gap. No commit/push/release unless requested. Dependencies: P3.1–3.3.

## Risks and rollback

Provider quota may be unavailable: unsupported must be visible; no mock live success. Filesystem nesting/symlinks can duplicate projects: canonical identity and bounded discovery tests required. Connection loss is not completion: persist interrupted states. Scene updates can destroy drafts or spatial memory: separate data, layout and camera state. WebGL can fail: accessible boards/list remain operational with explicit scene error.

Keep new route/scene isolated, retain prior routes, scope storage additions to the new contract, and document migrations. Reverting town UI must not delete durable tasks/messages or rewrite project repositories. No automatic checkout cleanup or merge as rollback.

## Local source run and use notes

These commands run the current source build on separate ports; they do not update or replace an installed server. Use free ports (examples: Core 7341, Web 3002). Run from the repository root with Node 22+ and the repository's pnpm version. Existing profile configuration and default selection remain unchanged.

Build once:

```sh
pnpm install --frozen-lockfile
pnpm build
NEXT_PUBLIC_HARNESS_HTTP_URL=http://localhost:7341 NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7341 pnpm --filter harness-web build
```

Core terminal:

```sh
HARNESS_PORT=7341 HARNESS_ALLOWED_ORIGINS=http://localhost:3002,http://127.0.0.1:3002 node dist/src/server/index.js
```

Web terminal:

```sh
pnpm --filter harness-web start --port 3002
```

Open [local Town](http://localhost:3002/town). The source compiler emits `dist/src/server/index.js`; use that explicit path rather than the currently stale `start:server` package-script path. Web public HTTP/WS endpoint variables are baked into the production build, so changing Core ports requires rebuilding Web with both variables. Alternate browser ports must appear in `HARNESS_ALLOWED_ORIGINS`; default policy only allows port 3000. Use `harness server list` to inspect registered servers without stopping unrelated instances.

Town initially uses `~/Desktop/development`. Survey discovers repositories read-only and reports scan status. A partial scan is not a complete inventory: review skipped/error information and repository Git freshness; missing commits remain unknown. Select a project in the registry or map, focus its building, use its board, or expand Bell Hall to give the orchestrator an instruction. Pins and named viewpoints persist through Town settings.

The current quota adapter supports Codex OAuth through authoritative app-server account limits and verified account scope. API-key profiles currently report unsupported quota, even when their ordinary model calls work. Check capacity displays the current evidence; unsupported/unavailable/stale/exhausted capacity queues dispatch. Select an already configured supported profile through the existing profile flow; these instructions neither add a second selector nor change the default profile. Internal cost estimates cannot unblock provider capacity.

Worker steering messages persist in the Town inbox and are read on the worker's next `TownRead`; sending one does not guarantee immediate interruption or model consumption. Use the dedicated question-answer control for a parked question. After a server restart, active work is interrupted truthfully. Current queue polling visits only Town user stores opened by a request in that process: reopen `/town` for the same user after restart to load its store and enable queued-work polling. This startup wake limitation remains until persisted stores are enumerated independently.

An isolated acceptance preview uses its own state/home and can contain fixture projects or tasks. It is distinct from the user-installed server and normal Town data; do not infer installed-version parity or live-provider success from preview screenshots. Conversely, these source-run commands use normal existing user configuration/state: they are not an isolated fixture recipe and should not be described as one. No credentials or secret contents belong in run logs or evidence.
