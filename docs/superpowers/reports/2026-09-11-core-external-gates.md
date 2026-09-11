# Core external acceptance gates — 2026-09-11

Local host: Darwin arm64. Installed commands resolve to `~/.local/bin/harness` and `~/.local/bin/harness-server`; paths alone do not establish commit provenance. This review did not replace binaries, restart user services, inspect credentials, or issue paid inference.

| Gate | Procedure and evidence required | Current status / task |
|---|---|---|
| Installed versus checkout | Record checkout commit, package version, build command and artifact digest; identify running process executable and `/health` version. Match executable digest to built artifact. Matching version strings alone are insufficient. | Unverified; PT-013 |
| Windows runtime | On Windows, run documented PowerShell installation in a disposable user environment; validate PATH, CLI init/doctor, server start/stop and TUI reconnect. Record OS, artifact provenance, exit codes and cleanup. | Not executed on macOS; PT-013 |
| Physical voice | With selected hardware/profile, exercise STT → model → TTS, interrupt playback, reconnect device, switch/concurrently run profiles; confirm no cross-profile audio and resources released. Record device and observed behavior separately from fake voice tests. | Device acceptance pending; PT-015 |
| Live Codex | Follow Codex spec and existing acceptance report: account login/entitlement, catalog, text/tool/multi-turn, continuation/restart, refresh and usage attribution. Use a deliberately selected account/profile, retain redacted evidence and observed billing semantics. | No live account/provider calls in this Core fixture pass; PT-014 |
| Client adoption | Validate clients use scoped reads, acknowledged decisions and runtime snapshots, including event overflow and reconnect; validate effort picker separately. | Separate client plan and PT-016; generated types are insufficient |

These gates do not block isolated local Core tests, but must not be labeled passed by those tests. Authentication/RBAC, new transport adapters, game UI and deployment remain outside the Core uplift implementation scope. Multi-process exactly-once external effects and cross-session execution handoff are not supplied by current runtime contracts.
