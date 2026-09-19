# Orchestrator Town v1 — build specification

Date: 2026-09-13. Task: PT-052. Status: approved for implementation.

Primary feature: ORCH-06, with ORCH-01–05, ORCH-07–08. Core ownership is
CORE-02/03/07/09/10/11. The Web client owns the medieval 3D scenery and camera;
Core owns reusable discovery, durable project/task/team/message state, dispatch,
quota evidence and recovery. No authentication or account/RBAC work is in scope.

This replaces the open implementation questions in the [discovery](2026-09-13-orchestrator-town-discovery.md), without rewriting its historical record.

## Outcome

`/town` is a navigable, simulated-3D medieval town backed by real project and
agent state. A discovered repository is one stable building. The town hall lets
the user give a goal to a real orchestrator run. That run must create, assign and
start real worker tasks through the existing runtime; it cannot merely create
strings that look like tasks. Workers may post durable status, questions and
handoffs. A project becomes central when it has live work; otherwise its last
verified Git commit determines its outer activity ring. Unknown Git or runtime
state is labelled unknown, never animated as progress.

The root is the configured absolute directory, defaulting to
`~/Desktop/development`. The first release reads it only. No project is silently
created from a directory that is not a Git worktree.

## User experience

- The 3D town supports orbit, pan, tilt and zoom. It has town and focused-building
  views, a return-to-town-hall action, saved named viewpoints and stable building
  positions between deliberate discovery refreshes.
- The town hall remains a DOM command and status panel over the scene. It shows
  provider capacity, queued work, questions needing the user and the real
  orchestrator's current run. Project labels face the camera; project/task boards
  are ordinary accessible side panels, not texture text.
- A project building is an office unless it has a real active construction task.
  Dormant and untouched repositories remain quiet offices; the town never invents
  a next task or construction state. Its board shows
  tasks, agents, handoffs, blockers, Git freshness, workspace mode and evidence.
- Clicking a worker opens its task, session/run, current lifecycle state and a
  direct message/steer form. The user can cancel it or answer a question using
  the existing ownership and approval controls.
- Town placement is a projection: active tasks occupy the central ring; inactive
  projects use bounded commit-age bands. User pins override bands. A refresh may
  change unpinned bands; the UI says when that happened. It never represents a
  commit age as importance or completion percentage.

## Durable domain and recovery

All records are per sanitized user and atomically revisioned under
`~/.harness/orchestrator/<user>/`; project discovery cache is separate from the
existing lightweight `Project` session-tag record. New IDs are opaque UUIDs.

| Record | Required fields |
|---|---|
| `TownSettings` | revision, discovery root, ignore policy/version, saved viewpoints, pinned project IDs |
| `TownProject` | id, canonical repo path, parent project ID if retained, remote/head/dirty/latest commit, scanned_at, scan status/error, display metadata |
| `TownAgent` | id, profile, role, display name, home project optional, lifecycle (`persistent` or `task_bound`) |
| `TownTask` | id, project ID, title, prompt, state, revision, assigned agent, dependencies, workspace mode, session/run IDs, created/updated/terminal evidence |
| `TownMessage` | id, project/task/thread IDs, from/to identities, `status|question|answer|handoff`, body, artifact IDs, delivery/acknowledgement and timestamps; answer receipt where applicable |
| `QuotaSnapshot` | provider/account scope hash, status, fetched_at, expires_at, normalized windows, raw-source version, last error |
| `DispatchLease` | task, provider/account scope, acquired/expires timestamps and release reason |

Task transitions are append-only audit events and have optimistic revisions:
`draft → ready → queued_quota|queued_dependency|queued_workspace|queued_concurrency → dispatching → running → waiting_user|blocked → completed|failed|cancelled|interrupted`. A parked `waiting_user` task may enter `queued_quota` only for an accepted answer whose continuation is held for fresh capacity; that continuation resumes to `running` without creating a new task.
Only an explicit transition can change terminal state. On process restart,
`dispatching` and `running` become `interrupted`, their leases expire, and no
worker callback, workspace lease or provider reservation is recreated. The
orchestrator can propose a retry; it must pass fresh dispatch gates.

The old in-memory bulletin remains a live convenience only. Every Town message
is persisted before an optional mirror is emitted to the current session board.

## Discovery contract

`POST /town/discovery/refresh` walks only inside the canonical configured root.
It uses `lstat`, never follows symlinks, ignores `.git`, dependency/build/cache
directories by default, caps directory entries/depth/time, and reports skipped
or failed paths. A directory is a candidate only when its own `.git` resolves to
a worktree/repository. Nested repositories become separate projects and carry a
parent path relationship; no parent project implicitly controls a nested repo.
Canonical paths deduplicate projects. Discovery reads Git HEAD, dirty state and
latest commit timestamp without modifying a checkout. Missing Git, unreadable
paths and cap exhaustion produce explicit `unknown`/`partial` records.

## Provider capacity is a hard dispatch gate

Internal `RunBudget` USD/tool/wall limits remain a secondary runtime guard. They
are not provider quota and cannot allow automatic dispatch.

`QuotaProvider` is a Core interface returning provider-authoritative remaining
capacity, windows/reset times, account scope and freshness. It exposes only
normalized, non-secret fields. A capability is `available`, `unavailable`,
`stale`, `exhausted` or `unsupported`.

For Codex OAuth, the implementation starts with a compatibility spike against
the installed `codex app-server` protocol: it must prove a documented/local
protocol request returns the account's current rate-limit windows, used percent
and reset timestamps. Existing local Codex event records demonstrate that such
rate-limit data exists, but are not a supported integration contract. If the
spike cannot establish a stable protocol, Codex is `unsupported` and automatic
start is held. For API-key providers, implement a provider-specific documented
usage/quota endpoint only where it returns remaining capacity for the scoped
account; otherwise it is `unsupported`. A 402/429 quota response updates the
snapshot to `exhausted` but never invents a reset time.

### Explicit user-authorized manual attempt (PT-060 addendum, 2026-09-14)

The automatic capacity rule above remains fail-closed. For a specific queued
root planner task, the user may submit a current-revision dispatch request with
`manual_quota_override: true`. The server records the actual quota provider,
status, source, requester and timestamp on the task and still returns/persists
the measured quota unchanged. This is an auditable user-authorized attempt, not
a quota reservation or an `available` result.

Only that root read-only orchestrator and direct child tasks it creates through
its bound Town tools while the root run is active may use the request's narrow
authorization. Children retain their own workspace mode and normal runtime
ACL. Dependency, project, lease/concurrency, runtime, approval, ACL and
RunBudget gates still apply. The scheduler, startup recovery, direct child REST
dispatch, descendants, continuations and other tasks do not inherit it; an
independent task continues through the ordinary provider-capacity gate.

Admission requires: a fresh `available` snapshot for the exact selected
provider/account scope; every applicable provider window has remaining capacity
and is not provider-marked exhausted; a free
project workspace lease; ready dependencies; and a free bounded dispatch slot.
Unknown, stale, unsupported, account-scope-mismatched or error quota means
`queued_quota`, with the displayed source, age and retry action. The first
release does not guess remaining tokens, convert API-equivalent USD to quota, or
reserve provider quota it cannot reserve remotely. It serializes automatic
starts per provider/account scope (one `dispatching` task); successful starts
re-read capacity before the next task. The provider can still reject an
in-flight request, which becomes truthful `failed`/`quota_exhausted` evidence.

## Workspace and agent execution v1

Each task declares one mode: `read_only`, `shared_checkout`, or
`isolated_worktree`. `read_only` permits parallel tasks only with a runtime ACL
overlay that denies every mutating builtin, MCP and shell operation; a profile
that permits Bash does not make this mode safe. `shared_checkout` has a
durable exclusive project mutation lease; only one mutation-capable task can be
running or dispatching per project. `isolated_worktree` creates a named worktree
outside the source checkout, tied to the task and removed only by a future
explicit cleanup feature. v1 permits automatic execution only in `read_only`
and `shared_checkout`; isolated worktree creation requires an explicit user
action until cleanup/review semantics exist. There is no auto-merge, push or
conflict resolution.

The orchestrator is a configured profile with a narrow Town tool set:
`TownRead`, `TownCreateTask`, `TownAssign`, `TownPost`, `TownAsk`, and
`TownDispatch`. `TownDispatch` performs all gates and then invokes the existing
profile/agent runtime with the task's selected session working directory and
real lifecycle events. It records the returned session/run ID before presenting
the worker as running. The worker's tools remain governed by its profile ACL and
ordinary approval rules. The orchestrator cannot bypass them.

## Frozen v1 HTTP/SSE contract

All endpoints apply existing caller user scope. Mutations require a current
revision and return `409` on conflict. Errors are `{ error, code, details? }`.

| Method/path | Contract |
|---|---|
| `GET /town/snapshot?after=` | Snapshot or ordered event delta: settings, projects, teams, tasks, messages, quota and `next_cursor`; stale cursor gets a full snapshot with `resync:true` |
| `PATCH /town/settings` | `{ revision, root?, saved_viewpoints?, pinned_project_ids? }` → revisioned settings; root uses the same canonical root policy |
| `POST /town/discovery/refresh` | `{ root? }` → accepted refresh record; completion emits discovery events. Root changes require an absolute path inside the configured root policy. |
| `GET /town/projects/:id` | Project detail and board, including source freshness/errors |
| `POST /town/tasks` | `{ project_id,title,prompt,agent_id?,workspace_mode,depends_on?,revision? }` → durable `draft` task |
| `POST /town/tasks/:id/transition` | `{ revision,to,reason? }` → validated transition; no direct terminal rewrite |
| `POST /town/tasks/:id/dispatch` | `{ revision }` → dispatch decision/result; starts an actual runtime only after every gate |
| `POST /town/messages` | `{ project_id,task_id?,to,kind,body,artifact_ids?,reply_to?,revision? }` → durable message |
| `POST /town/messages/:id/ack` | `{ revision }` → acknowledged delivery |
| `POST /town/messages/:id/answer` | `{ revision,body,answer_key }` → durable answer plus a matching continuation result or held `queued_quota` receipt |
| `POST /town/orchestrate` | `{ instruction, project_ids?, revision? }` → real orchestrator run and resulting task/event references |
| `GET /town/quota` | Current normalized provider capacity, source/method, account-scope match, freshness and last error; no secrets or estimated remaining tokens |

`GET /town/events?after=` is SSE with the same monotonic cursor semantics as
the snapshot. The Web route reconnects by cursor and renders resync, stale and
unavailable states explicitly.

### DTOs and dispatch result

Every `TownProject` response has `{ id,path,parent_id?,git:{head?,dirty?,
last_commit_at?,status},scanned_at,display }`. Every `TownTask` response has
`{ id,project_id,title,prompt,state,revision,agent_id?,depends_on,
workspace_mode,session_id?,run_id?,block_reason?,created_at,updated_at }`.
`TownMessage` is `{ id,project_id,task_id?,from,to,kind,body,artifact_ids,
reply_to?,state:'delivered'|'acknowledged',revision,created_at,acknowledged_at?,answer_outcome? }`, where an answer outcome is `{ resumed,state?,error? }`.
`QuotaSnapshot` is `{ provider,account_scope,status:'available'|'unavailable'|
'stale'|'exhausted'|'unsupported',fetched_at?,expires_at?,windows:[{
limit_id?,used_percent,window_minutes?,resets_at?}],source,last_error? }`.
`GET /town/snapshot` returns `{ cursor,generated_at,resync?,settings,projects,agents,
tasks,messages,quota }`; events are `{ cursor,type,occurred_at,data }`.

`POST /town/tasks/:id/dispatch` returns either
`{ decision:'started',task,session_id,run_id,quota }` only after runtime start,
or `{ decision:'queued',task,reason:'quota'|'dependency'|'workspace'|
'concurrency',quota }`. It must never return `started` before it holds the
workspace/dispatch leases and records the run/session linkage. `POST
/town/orchestrate` returns `{ decision:'started',orchestrator_task,session_id,run_id }`
or `{ decision:'queued',orchestrator_task,reason:'quota'|'concurrency',quota }`.
The orchestrator's own model call passes the same capacity gate before it can
consume a token. Task creation and dispatch events appear through the same event
cursor.

The app-server adapter sends JSON-RPC `account/rateLimits/read` with no params;
its generated schema defines `rateLimits`, `rateLimitsByLimitId`, windows with
`usedPercent`, optional `windowDurationMins` and `resetsAt`, plus exhausted
state. It runs the child app-server in external-token mode with a short-lived
in-memory Base OAuth credential, uses `account/login/start` with its schema's
`chatgptAuthTokens` variant, then reads account and rate limits. Base already
derives `chatgpt_account_id` from OAuth id/access-token claims; compare that
value in memory to the selected credential/header scope and store only a one-way
scope hash. Tokens, account IDs and raw login payloads are never logged or
persisted. No match or failed probe means `unavailable` and `queued_quota`.

`TownAsk` persists a `question` message with a task-owned opaque
`continuation_id`, moves the task to `waiting_user`, and parks the worker using
the existing durable pending-input mechanism. Answer requires `answer_key` and
atomically records the answer before resolving its matching continuation. Just
before a parked continuation can make its next model call, Core re-probes the
selected provider/account scope. Insufficient capacity records a durable
`queued_quota` answer receipt, retains the continuation and rechecks it on the
bounded queue cadence; recovery resumes that same continuation once, without a
new task or answer. The same key always returns its original receipt and never
resumes twice. Cancellation, terminal transition, expiry or restart closes the
continuation; a late answer is refused, and restart marks the task
`interrupted` rather than waiting.

## Delivery slices and acceptance

1. **Core records/discovery:** bounded fixture and real temporary Git trees,
   nested repos, symlink/dependency exclusions, path errors, atomic revisions,
   restart rehydration and cursor resync.
2. **Capacity and safe dispatch:** fake authoritative quota adapter tests for
   available/stale/unavailable/exhausted and concurrent admission; Codex app-server
   compatibility spike with captured redacted evidence. No adapter means held
   automatic dispatch, never a local-budget substitute.
3. **Tasks/messages/workspace:** transition/dependency tests, durable question
   round trip, serial shared-checkout collision refusal, interruption after
   restart and real worker runtime invocation fixture proving a run/session and
   lifecycle frames are attached to the task.
4. **`/town`:** fixture-backed navigable 3D camera, stable/pinned placement,
   labels and accessible DOM boards; browser checks for town/focus/saved view,
   quota-held queue, worker status/question and stale/unavailable truth.
5. **Live acceptance:** run the authorized bounded read-only scan of the
   configured root and record its evidence; separately obtain user UX acceptance
   for the real landscape. Verify quota adapter status for the selected provider,
   one successful real orchestrator → worker task, one question/answer, and one
   restart shown as interrupted. No release/deployment claim follows local tests.

Out of v1: automatic merge/push, conflict resolution, remote/multi-host
workspaces, provider quota reservation unavailable from the provider, roof-off
interiors, replay timeline and fabricated project-health scores.
