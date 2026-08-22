# Read API

The server exposes accumulated harness state on the same port as the WebSocket
transport. Browser requests must match `HARNESS_ALLOWED_ORIGINS`; bearer auth
continues to apply when `HARNESS_API_KEY` is configured.

All routes accept `user` for namespace selection. They are read-only except
`POST /datasets`, which accepts one multipart `file` and optional `name`.

| Route | Purpose |
|---|---|
| `GET /metrics` | Tool, model, stage, and daily telemetry aggregates. |
| `GET /usage` | Usage ledger plus monthly series. |
| `GET /audit` | Paginated audit entries and filters. |
| `GET /memory` | Scoped memory list/query with temporal fields. |
| `GET /triggers` | Configured cron, watch, and poll snapshots. |
| `GET /sessions/:id/messages` | Paged transcript projection. |
| `GET /stats/routing` | Routing aggregate used by the CLI. |
| `GET /datasets` | Uploaded dataset metadata. |
| `GET /datasets/:id/schema` | Inferred CSV/JSON schema. |
| `GET /datasets/:id/preview?rows=50` | Bounded preview rows. |
| `POST /datasets` | Multipart dataset upload. |

`/audit` and `/memory` return `Cache-Control: no-store`. The aggregate endpoints
return a short cache lifetime and ETag. Missing source files return empty data,
not errors, so new installations render cleanly.
