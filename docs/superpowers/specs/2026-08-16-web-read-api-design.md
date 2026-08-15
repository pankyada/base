# Read APIs & Transport Hardening — Design (W1)

> Date: 2026-08-16
> Status: Draft (design)
> Related: [`2026-08-16-web-surface-design.md`](2026-08-16-web-surface-design.md),
> [`../plans/2026-08-16-web-surface.md`](../plans/2026-08-16-web-surface.md), `docs/ROADMAP.md`

## Goal

Every dashboard proposed for the web surface reads state that exists on disk and
has no HTTP surface. `harness stats routing`, `harness audit`, and the usage
ledger are CLI-only. A browser cannot see any of it.

This design adds a **read-only HTTP layer** over data the runtime already
produces, plus the transport hardening that makes exposing it safe. One new write
endpoint (dataset upload) is included because the analyst face is inert without
it.

Nothing here changes agent behaviour. No module gains a dependency; each endpoint
is a wrapper over an existing exported function.

### Non-goals

- Not authentication. Posture is single-operator localhost
  ([W0 §3](2026-08-16-web-surface-design.md)); the boundary is origin + optional
  bearer key.
- Not a query language. Fixed filters and fixed aggregations only.
- Not a database. Reads scan the same JSONL/JSON files the CLI scans.
- Not real-time. Live data flows over WS; these endpoints are pull, cacheable,
  and may be seconds stale.

---

## 1. Transport hardening (prerequisite)

### 1.1 The hole

WebSocket upgrades are not subject to same-origin policy, and no `Origin` check
exists on the server. Any page loaded in the operator's browser can:

```js
const ws = new WebSocket('ws://localhost:7337')
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'hello', user_id: 'x', yolo: true }))
  ws.send(JSON.stringify({ type: 'message', content: '…' }))
}
```

With `mode: developer` and `yolo: true`, that is unprompted shell execution
initiated by a third-party web page. The `yolo` flag is browser-asserted
(`web/hooks/useHarnessWS.ts:30`), so the approval prompt that would otherwise
catch it never fires.

Deferring *login* is a defensible product decision. Deferring these two fixes is
not, because the exposure exists whether or not the web client is used.

### 1.2 Origin allowlist

```ts
// src/server/origin.ts
export interface OriginPolicy {
  allowed: string[]        // exact origins, no wildcards
  allowBrowserless: boolean // requests with no Origin header (TUI, CLI, curl)
}

export function loadOriginPolicy(env = process.env): OriginPolicy
export function checkOrigin(origin: string | undefined, policy: OriginPolicy):
  { ok: true } | { ok: false; reason: string }
```

- Source: `HARNESS_ALLOWED_ORIGINS`, comma-separated. Default
  `http://localhost:3000,http://127.0.0.1:3000`.
- Exact string match on scheme + host + port. No wildcard, no suffix matching —
  `evil-localhost.com` must never match.
- Missing `Origin` → allowed only when `allowBrowserless` (default `true`, since
  the TUI and CLI send none). This is an explicit branch, not a fallthrough:
  a browser always sends `Origin` on WS upgrade and on cross-origin `fetch`, so
  the browserless path is not a browser bypass.
- `HARNESS_ALLOWED_ORIGINS=*` is accepted, logs a startup warning, and is the
  documented escape hatch for reverse-proxy deploys.

Applied at two points: the `upgrade` handler in `src/server/index.ts` (reject with
`403` before the socket is accepted) and the top of `createRestHandler`
(`src/server/rest.ts:623`), before any route match.

Rejections are logged and counted; `GET /health` reports the effective policy so a
misconfiguration is diagnosable without reading the process env.

### 1.3 Approval authority

`hello.yolo` is ignored. Effective approval mode resolves as:

```
profile.approval_mode  ⊓  HARNESS_APPROVAL_MODE  ⊓  ceiling(profile.mode)
```

`set_approval_mode` is honoured only up to that ceiling; an over-reach is answered
with `notice { level: 'warn' }` and the mode is left unchanged. `session_ready`
already carries `yolo`; it becomes advisory display state derived from the server's
resolution, and the client renders whatever it is told.

Back-compat: existing clients that send `hello.yolo` keep working; the flag simply
no longer grants anything. Recorded in the protocol docs as removed-in-effect.

---

## 2. Endpoints

All under the existing HTTP server on `:7337`, all `GET` unless noted, all
answering JSON, all subject to §1 and the existing `HARNESS_API_KEY` check
(`src/server/rest.ts:634`). All accept `?user=` (default: the server's resolved
user) and scope to that namespace.

### 2.1 `GET /metrics`

Aggregation over `~/.harness/telemetry.jsonl` via the existing `queryEvents`.

```
?since=ISO|7d  &until=ISO  &profile=  &kind=  &group=tool|model|stage|day
```

```jsonc
{
  "window": { "since": "...", "until": "...", "events": 4210 },
  "tools":  [{ "name": "Bash", "calls": 190, "ok_rate": 0.97,
               "p50_ms": 40, "p95_ms": 2100, "cost_usd": 0 }],
  "models": [{ "id": "...", "calls": 88, "tokens_in": 1.2e6,
               "tokens_out": 90000, "cost_usd": 4.12 }],
  "stages": [{ "stage": "build", "runs": 30, "escalations": 4,
               "verify_first_try": 0.7, "cost_usd": 2.90 }],
  "daily":  [{ "day": "2026-08-15", "cost_usd": 1.10, "sessions": 6 }]
}
```

Telemetry is append-only JSONL with rotation. The reader must stream, honour the
`since` bound before parsing where possible, and tolerate a truncated final line
(a crash mid-write must not 500 the dashboard).

### 2.2 `GET /usage`

`readUsage(user)` verbatim, plus a derived per-month series for charting. No
computation the ledger does not already hold.

### 2.3 `GET /audit`

`listAudit(user, tool?, since?)`, paginated.

```
?since=  &tool=  &effect=read|write|outbound|destructive
&decision=allow|prompt|deny  &tainted=true|false  &limit=  &cursor=
```

Returns `AuditEntry` records as-is (`src/audit/journal.ts:7`) — including
`decided_by`, `decided_reason`, `tainted`, and the presence (not the content) of
an `undo` payload. Input digests stay digests; the endpoint never rehydrates
arguments.

### 2.4 `GET /memory`

`MemoryProvider.list(scope)` / `.query(scope, RecallQuery)`
(`src/memory/interface.ts:45`).

```
?scope=session|user|profile|project  &q=  &entity=  &at=ISO  &include_superseded=
```

Returns entries with temporal metadata (`valid_from`, `valid_to`, `superseded_by`)
so the client can draw the timeline. `POST`/`DELETE` are **not** added here — memory
writes stay on the WS/tool path, where ACL, provenance, and audit already apply.
The explorer's edit affordance issues a `MemoryWrite` tool call through the
session, keeping one write path.

### 2.5 `GET /triggers`

Registry snapshot: name, kind (`cron`/`watch`/`poll`), schedule or source, enabled,
`last_fire`, `next_fire`, and fire/skip counts joined from telemetry
(`kind: 'trigger'`, `fired`, `skip_reason`). Read-only; enable/disable is deferred
until there is a reason to mutate config over HTTP.

### 2.6 `GET /sessions/:id/messages`

Projected transcript for rehydration on reload. Returns the ledger's user/agent/
tool entries in order, with tool results truncated to a bounded preview and a
`restore_handle` where the projection elided them (`src/context/projection.ts`).
Supports `?limit=` + `?before=` so the client loads the last N turns and pages
backwards (W0 §8 open question 2).

### 2.7 `GET /stats/routing`

`aggregateRouting(events, opts)` (`src/analysis/routing.ts:44`) as JSON —
the same `RoutingReport` the CLI prints. No new maths.

### 2.8 `GET|POST /datasets`

The one write endpoint.

```
POST /datasets   multipart/form-data: file, name?
GET  /datasets            → [{ id, name, bytes, rows?, columns?, created_at }]
GET  /datasets/:id/schema → { columns: [{ name, dtype, nulls, distinct, sample }] }
GET  /datasets/:id/preview?rows=50
DELETE /datasets/:id
```

Storage: `~/.harness/datasets/<user>/<id>/` where `id` is server-generated. The
client-supplied filename is stored as metadata only and never used as a path
component. Extension allowlist `.csv .tsv .json .ndjson .parquet`; default cap
100 MB (`HARNESS_DATASET_MAX_BYTES`).

Schema inference is header + first-N-rows sniffing in TypeScript for delimited and
JSON formats. Parquet metadata is read only if a dependency-free reader is
practical; otherwise Parquet uploads store and preview as opaque and schema comes
from the analyst's own first `ExecuteCode` call. **No new heavyweight dependency
enters the backend for schema sniffing.**

The dataset root is exposed to the executor and to `Read` ACL as a path the profile
may allow. Datasets are *data*, so anything derived from them is
provenance-`untrusted` under #22 — an uploaded CSV must not be able to authorize an
action.

---

## 3. Shared concerns

**Pagination.** Opaque cursor (`{ file, offset }` base64) for the JSONL-backed
endpoints. `limit` default 100, max 1000.

**Caching.** `Cache-Control: no-store` for `/audit` and `/memory`; short
`max-age` plus `ETag` derived from source-file mtime+size for `/metrics`,
`/usage`, `/stats/routing`.

**Errors.** Existing `sendJson` conventions: `400` bad params, `401` bad key,
`403` bad origin, `404` unknown id, `413` upload too large, `500` otherwise. A
missing source file is `200` with an empty result, never `404` — a fresh install
has no telemetry and the dashboard must render empty, not broken.

**Cost.** Every endpoint must answer a typical window in <200 ms on a
100 MB telemetry file. If it cannot, it streams or narrows the window rather than
introducing an index — no new storage engine in this track.

---

## 4. Module layout

```
src/server/origin.ts        # NEW  allowlist policy + check
src/server/read-api.ts      # NEW  route table for §2, thin wrappers only
src/server/index.ts         # MOD  origin check on upgrade; ignore hello.yolo
src/server/rest.ts          # MOD  origin check; mount read-api routes
src/datasets/store.ts       # NEW  upload, list, schema sniff, preview, delete
src/datasets/types.ts       # NEW
src/telemetry/aggregate.ts  # NEW  /metrics maths (pure, unit-tested)
```

No changes to `src/loop/`, `src/tools/`, `src/workflow/`, `src/memory/`.

---

## 5. Telemetry

The read layer itself logs nothing per request — observing the observer inflates
the file it reads. Origin rejections log once per rejection at `warn` with the
offending origin, which is a security event, not an access log.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Allowlist breaks an existing deploy | `allowBrowserless` default true; compose sets the var; `/health` reports the policy; `*` escape hatch documented |
| A malicious local page reads `/audit` | Origin check applies to REST before route match; API key still available |
| Upload as arbitrary-write | Server-generated ids, fixed root, extension allowlist, size cap, filename never used as path |
| `/metrics` slow on a large JSONL | Streaming reader, `since` bound applied while scanning, rotation already caps file size |
| Uploaded data laundering trust | Datasets are provenance-untrusted, same as any network-sourced content under #22 |

## 7. Open questions

1. Should `/metrics` accept `group=` combinations, or ship four fixed shapes?
   Fixed shapes are proposed; combinations invite a query language.
2. Parquet: dependency-free reader, or opaque-store-only for v1?
3. Does `/triggers` eventually need `POST /triggers/:name/fire`? Useful, but it is
   a *write* over HTTP against the scheduler — deferred until the console proves
   the need.
