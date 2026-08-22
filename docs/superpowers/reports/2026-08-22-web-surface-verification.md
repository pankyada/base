# Web surface #27–#29 verification

Date: 2026-08-22. Evidence is source-level plus a real browser run of
/surface-escape. Roadmap items remain ❌ where a checklist bullet is still
partial; green tests do not turn a hollow UI into a shipped acceptance.

## #27 — generative surfaces and widget kit

| Checklist | Result | Evidence |
|---|---|---|
| Opaque iframe, strict CSP, no network, bridge, diagnostics, timeout, corpus | Verified | web/surface/SurfaceHost.tsx:31-78, web/surface/frame.ts:1-16, web/surface/bridge.ts:1-14, web/app/_fixtures/surface/SurfaceEscapeFixture.tsx:10-43 |
| Plot plus eight marks and supporting views | Partial | web/widgets/GenWidget.tsx:18-42 routes every kind, but Heatmap.tsx:1, Box.tsx:1, and Correlation.tsx:1 are JSON pre renderers rather than chart views |
| Honesty rules (baseline, null gaps, stable colours, collapse) | Verified | web/widgets/Plot.tsx:13-93, web/widgets/scale.ts:1-30 |
| DataTable sort/filter/pin/virtualization/filtered CSV | Verified | web/widgets/DataTable.tsx:4-27 |
| Notebook files inline/downloadable | Verified | web/components/data/NotebookCell.tsx:4-22 |
| Pyodide package allowlist, lazy boot, worker | Verified | web/surface/SurfaceHost.tsx:9-13,31-39,59-67, web/components/data/python.worker.ts:1-21, web/components/HarnessPython.tsx:27-112 |

Escape corpus result: strict sandbox produced blocked for all six entries.
With a deliberate local allow-same-origin weakening, entries 0–3
(window.parent.document.body, top.location.href, document.cookie, and
localStorage.setItem(...)) became escaped; entries 4–5 stayed blocked by
connect-src 'none'/missing form. The weakening was reverted before validation.

## #28 — analyst workbench

| Checklist | Result | Evidence |
|---|---|---|
| Dataset upload/schema/preview/context/untrusted badge | Verified | web/components/data/DatasetDrawer.tsx:7-24, web/components/data/SchemaCard.tsx:3-7 |
| Canvas pin/provenance/reorder/resize/refresh/last-good stale | Partial | persistence and refresh helpers exist in web/lib/canvas.ts:1-43; rendering and stale badge are in web/components/data/Canvas.tsx:8-30, but Workspace does not pass onRefresh and provenance is only {session:'current',toolCall:'artifact'} at web/components/Workspace.tsx:50 |
| CSV, PNG/PDF, self-contained HTML export | Partial | CSV/HTML/PDF and Canvas controls are in web/lib/export.ts:1-74 and web/components/data/Canvas.tsx:28-30; table export is helper-only and PDF is text-oriented rather than a full SVG raster export |
| Three-pane Artifacts/Surfaces/Canvas layout | Verified | web/components/Workspace.tsx:22-50 |

## #29 — operator console and assistant surface

| Checklist | Result | Evidence |
|---|---|---|
| Run board lanes/live overlay/waiting input distinction | Partial | web/components/ops/RunBoard.tsx:4-20 has status classes/labels and live merging, but no lane layout or explicit visual treatment |
| Approval provenance, previews, queue, server-granted always allow | Partial | queue, risk/reason, and JSON previews exist at web/components/ops/ApprovalQueue.tsx:1-6; no provenance quote or always-allow grant response |
| Inbox TTL; grouped undo with stale/force | Partial | TTL is real at web/components/ops/Inbox.tsx:4-8; undo stale/force exists at web/components/ops/UndoDrawer.tsx:3-5, but entries are not grouped by run |
| Tainted audit filter | Verified | web/components/ops/AuditTable.tsx:4-16 |
| Observability and budget terminal state | Partial | aggregation helpers and budget label exist at web/components/ops/Observability.tsx:1-5; UI renders one JSON block and /ops does not supply a budget report |
| /home brief cards | Partial | web/components/assistant/Brief.tsx:1-20 has waiting/runs/memory/triggers/usage/skills cards; no explicit next-fires, spend, expiring-beliefs, or tainted-attention data wiring |
| Memory temporal explorer and audited edits | Verified | web/components/assistant/MemoryTimeline.tsx:1-5 |
| Trigger fire/skip ratio | Verified | web/components/assistant/TriggerList.tsx:1-4 |
| Skills queue and channels | Partial | components exist at web/components/ops/SkillsQueue.tsx:1-3 and Channels.tsx:1, but /home does not fetch/render the channels view |

## Validation

- pnpm typecheck — pass.
- pnpm test — pass, 114 files / 673 tests.
- cd web && npx vitest run — pass, 21 files / 54 tests.
- ./scripts/check-boundary.sh — pass.
- Real browser: six of six escape entries blocked under strict posture; four
  turned red under allow-same-origin.
