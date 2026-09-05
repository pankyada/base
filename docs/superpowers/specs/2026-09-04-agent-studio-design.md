# Agent Studio — a game-layer control surface for multi-agent work — Design (STUDIO)

> Date: 2026-09-04
> Status: Draft (design)
> Related: `src/agents/{frames,events,catalog,pool,runner}.ts`,
> `src/tools/builtin/{delegate,delegate-fanout}.ts`, `src/safety/provenance.ts`,
> `src/types.ts`, `src/server/index.ts`, `scripts/gen-web-protocol.mjs`,
> `docs-site/.vitepress/theme/{UseCaseFilm.vue,films.ts}`,
> `docs/ROADMAP.md` #3 / #29, ADR-13, ADR-43, ADR-50, ADR-51, ADR-73/74
> Supersedes nothing. Extends the unbuilt Sprint 4 of
> [`2026-08-27-agent-fleet.md`](../plans/2026-08-27-agent-fleet.md) with a second,
> non-technical surface.

## Goal

Make a multi-agent run **watchable by someone who does not read logs**.

The harness already runs teams of agents. Today the only way to see one is a
terminal transcript or a lane table — both of which assume you know what a tool
call is. Studio renders the same event stream as a **place**: a small office
floor where each agent is a figure at a desk who walks to a room to do work,
queues at your desk when it needs permission, pins notes on a shared board, and
goes home when it is done.

Three claims it must earn:

- **Glanceable.** In under three seconds, a non-technical operator can say who is
  working, who is stuck, who needs them, and what it has cost.
- **Honest.** Nothing is prettier than the truth. An approval card shows the real
  tool and the real arguments; a tainted document carries a visible red tag.
- **Steerable.** Hiring, stopping, approving, and answering are the same four
  verbs the protocol already has — not a second control path.

## Audience and success criteria

| Reader | Question they arrive with | Where Studio answers it |
|---|---|---|
| Non-technical operator | "Is anything happening? Does it need me?" | Floor at a glance; front desk queue is the only red thing |
| Same, five minutes later | "What did they actually do?" | Plain-English rail, one line per beat |
| Curious operator | "What is *that* one doing?" | Click a worker → drawer with its transcript |
| Power user | "I want the table back" | Console toggle — same reducer, different renderer |

Failure mode to design against explicitly: a cute animation that hides a
dangerous approval. Every legibility rule in §11 exists to prevent that.

## What already exists (verified 2026-09-04, do not rebuild)

| Piece | State | Where |
|---|---|---|
| Agent identity stamped at one seam | Shipped — `tagEvents` stamps `agent_id` on token / tool_* / prompt / stats / notice / todos / stage | [`src/agents/events.ts`](../../../src/agents/events.ts) |
| `AgentFrame` — id, name, parent, depth, origin, profile, session | Shipped | [`src/types.ts:156`](../../../src/types.ts) |
| `agent_spawn` / `agent_state` / `agent_stats` / `agent_end` / `agent_catalog` | Shipped, protocol 3 | [`src/types.ts:238`](../../../src/types.ts) |
| Human verbs `spawn` / `agent_cancel` / `agents_list` | Shipped, server-side | [`src/server/index.ts:539`](../../../src/server/index.ts), [`:668`](../../../src/server/index.ts) |
| Role catalog with `label`, `hint`, `prompt_field`, `example` | Shipped | [`src/agents/catalog.ts`](../../../src/agents/catalog.ts) |
| Bounded pool, per-child `AbortController` | Shipped | [`src/agents/pool.ts`](../../../src/agents/pool.ts) |
| Budget inheritance, monotonic taint, ACL | Shipped (ADR-43, ADR-50) | `src/runs/budget.ts`, `src/safety/` |
| Approval risk + reason on `tool_prompt` | Shipped | `src/types.ts`, `src/safety/rules.ts` |
| Workflow stage events (`onStage`) | Shipped | `src/workflow/`, `src/tools/types.ts` |
| Protocol mirror codegen for a browser client | Shipped — `web/lib/protocol.ts` generated from `src/types.ts`, `--check` in CI | [`scripts/gen-web-protocol.mjs`](../../../scripts/gen-web-protocol.mjs) |
| Animated-architecture prior art with reduced-motion fallback | Shipped | [`UseCaseFilm.vue`](../../../docs-site/.vitepress/theme/UseCaseFilm.vue), [`films.ts`](../../../docs-site/.vitepress/theme/films.ts) |

**The observability plumbing is done. What is missing is a renderer, a way for
agents to talk to each other, and a way for a second client to watch a live
session.**

### The four real gaps

1. **No surface renders the agent axis.** Sprint 4 of the fleet plan was never
   built; there is no `web/components/fleet/` and roadmap #29 is ❌. Every
   `agent_*` message currently lands in a reducer that drops it.

2. **Agents cannot address each other.** Delegation is a strict tree with
   one-shot task-in / typed-JSON-out. Siblings never exchange anything. `A2A`
   and `ACP` in [`src/server/rest.ts`](../../../src/server/rest.ts) are for
   *external* agents over HTTP; there is no in-session peer channel. Visually
   this is fatal: workers who never interact are not a team, they are a
   progress bar with faces.

3. **No fan-in moment.** `runBoundedPool` returns `PromiseSettledResult[]` to the
   parent and the children evaporate. The single most legible event in team work
   — everyone comes back and reports — has no representation on the wire.

4. **A second client cannot watch a live session.** `resume`
   ([`src/server/index.ts:986`](../../../src/server/index.ts)) *loads a persisted
   session into the calling connection*; it does not subscribe to another
   connection's in-flight turn. A standalone Studio therefore owns its own
   session today. See open question 1 — this is the one gap that constrains the
   chosen architecture.

## Non-goals

- **No new agent runtime.** ADR-13 stands: a profile is the only agent
  abstraction. Studio starts children through the existing `spawn` verb, which
  lands on the same executor as the model's tool call.
- **No graph/DAG authoring.** Studio dispatches and observes. Chaining belongs to
  `workflow:` (#15), which already owns stages.
- **No game engine, no physics, no pathfinding.** Walk paths are precomputed
  data, like `films.ts`. If it needs a tick loop beyond CSS, it is out of scope.
- **No editable child transcript.** Watching is read-only plus cancel, per the
  fleet spec's resolved question 2.
- **Studio does not replace the console.** The web app keeps its lanes and
  tables. Studio is the second face on one scene model.
- **No cross-machine fleet.** Children stay in-process under the parent session.

---

## Design

### 1. The floor plan

The floor is fixed data — rooms, desks, and the walk paths between them —
declared once in `studio/src/scene/floorplan.ts`, in the spirit of `films.ts`:
pure data, no rendering, no timing.

```
┌─ FRONT DESK (you) ──────┬── BOARD (bulletin + todos) ──┬─ VAULT (spend) ─┐
│  approval / question     │  pinned cards, standup table  │  meter, budget  │
│  queue, oldest at front  │                               │  ring           │
├──────────────────────────┴───────────────────────────────┴─────────────────┤
│   [desk 1]    [desk 2]    [desk 3]    [desk 4] …          BULLPEN (+N)     │
│   researcher  builder     writer      reviewer                              │
├─ LIBRARY ─────────────── WORKSHOP ─────────────── MAILROOM ────────────────┤
│  Read Grep Glob Skill     Bash Write Edit Execute  MCP WebFetch Channels    │
│  Recall MemoryRead                                                          │
├─────────────────────────── SECURITY GATE ──────────────────────────────────┤
│  ACL · provenance · danger rules — a worker pauses here before a red room   │
└─────────────────────────────────────────────────────────────────────────────┘
```

Room assignment is a pure function of tool name, seeded from the same
categorisation the TUI already uses in `section.go`. Unknown tools (including
every `<server>__<tool>` MCP name) route to MAILROOM, which is the honest answer:
it is talking to something outside.

The security gate is the design's one piece of deliberate theatre with a real
payload. A `tool_prompt` makes the worker stop at the gate before it can enter
the room — the danger is *spatially* obvious to someone who has never read an
ACL. `risk: 'danger'` colours the gate.

When `workflow.enabled`, `onStage` moves the whole team between floor *modes*
(recon → plan → design → build → verify → review) rendered as a banner and a
subtle palette shift, not six separate maps.

### 2. Scene state is a pure function of the event stream

```ts
// studio/src/scene/reducer.ts — no I/O, no timers, no DOM.
export function reduce(state: SceneState, message: ServerMessage): SceneState
```

```ts
interface SceneState {
  stage?: Stage
  workers: Record<string, Worker>        // keyed by agent_id
  seats: Record<string, number>          // agent_id → desk index, stable for life
  bullpen: string[]                      // agent_ids beyond floor capacity
  queue: DeskCard[]                      // tool_prompt + input_request, FIFO
  board: BoardCard[]                     // bulletin posts, newest first, capped
  standup?: { id: string; subject: string; expected: string[]; answered: string[] }
  spend: { usd: number; budget_usd?: number; tokens_in: number; tokens_out: number }
  feed: FeedLine[]                       // plain English, capped at 200
  artifacts: ArtifactCard[]
}

interface Worker {
  frame: AgentFrame
  activity: 'thinking' | 'reading' | 'building' | 'calling' | 'asking'
          | 'waiting' | 'blocked' | 'done'
  label: string            // one of eight fixed words, never a tool name
  room: RoomId
  tool?: string            // real tool name, shown in the drawer only
  since: number
  spend_usd: number
  tools: number
  tainted: boolean
  ended?: { status: 'completed' | 'failed' | 'cancelled'
          | 'budget_exceeded' | 'contract_violation'; error?: string }
}
```

Consequences that make this worth the discipline:

- **Testable.** A fixture array of `ServerMessage` in, a `SceneState` out.
- **Replayable.** A finished run's event log replays as a film — the same idea
  `films.ts` already encodes for the docs, now driven by real data.
- **Reconnect-safe.** `reduce(snapshot) + reduce(tail) === reduce(full)` is a
  test, which is what makes §9 sound.

The console renderer (lanes, tables) consumes the *same* `SceneState`. Two
renderers, one truth. That is the whole reason Studio does not fork the product.

### 3. The choreographer

Direct event→animation binding is unwatchable: a fan-out emits dozens of
`tool_start`/`tool_end` pairs in a few hundred milliseconds, and the floor
becomes a strobe. Between the reducer and the renderer sits a choreographer:

```
socket → ServerMessage[] → reduce() → SceneState (truth, immediate)
                                   ↘
                                     choreograph() → Beat[] (motion, lagging)
```

Rules, all testable:

1. **Coalescing window, 400 ms.** Consecutive tool activity for one worker in the
   same room collapses to a single walk plus a loop animation.
2. **Hero cap, 2.** At most two workers perform a full walk at once; the rest
   cross-fade between rooms.
3. **Lag ceiling, 2 s.** If the beat queue would put motion more than two seconds
   behind truth, the choreographer *fast-forwards*: it snaps positions and drops
   intermediate beats.
4. **Truth outranks choreography.** The scene may drop an animation. It may never
   drop, delay, or reorder a state change — above all a `tool_prompt`. An
   approval card appears at the front desk the instant it arrives, whether or not
   the worker's sprite has finished walking there.
5. **Floor capacity, 8.** Worker 9+ goes to the bullpen, rendered as a stack with
   a count. The rail still lists every one of them.

### 4. Event → choreography

Every row is an existing `ServerMessage`. No new instrumentation.

| Wire | Floor | Worker label |
|---|---|---|
| `agent_spawn` `origin: 'model'` | Figure enters from the door, nameplate onto next free desk | "joined" |
| `agent_spawn` `origin: 'operator'` | Enters from *your* desk — you hired them | "you hired them" |
| `turn_start` (root) | Lead stands up at the head desk | "thinking" |
| `token` | Small typing bubble; **never prose on the floor** | "thinking" |
| `tool_start` Read/Grep/Glob/Skill/Recall/Memory* | Walks to LIBRARY | "reading" |
| `tool_start` Bash/Write/Edit/ExecuteCode | Walks to WORKSHOP | "building" |
| `tool_start` WebFetch/WebSearch/`*__*` (MCP)/Notify | Walks to MAILROOM | "looking things up" |
| `tool_start` Delegate/DelegateFanout | Walks to the door and beckons | "getting help" |
| `tool_prompt` | Stops at SECURITY GATE; card slides to FRONT DESK queue | "needs your OK" |
| `tool_auto_approved` | Gate opens without a card; small "auto" chip | — |
| `input_request` | Raises hand; card to FRONT DESK | "asking you" |
| `tool_end ok:false` | Puff, red bulb over the desk, returns to seat | "hit a problem" |
| `tool_parked` | Sets the object down, sits | "paused" |
| `agent_state waiting_*` | Idle loop + elapsed clock | "waiting 2m" |
| `stats` / `agent_stats` | VAULT meter climbs; per-desk cost chip | — |
| `todos` | Sticky notes move columns on the BOARD | — |
| `artifacts` | Object materialises on the shelf, clickable | "made something" |
| `agent_message` (new, §7) | Walks to BOARD, pins a card; addressed post goes to a tray | "shared a note" |
| `standup` (new, §7) | Named workers converge on the meeting table, cards land, disperse | "reporting back" |
| `onStage` | Banner + palette shift; team migrates | "now: checking the work" |
| `agent_end completed` | Hands a folder to the front desk, exits; seat frees | "finished" |
| `agent_end failed` | Drops papers, exits; red seat marker persists | "couldn't finish" |
| `agent_end budget_exceeded` | VAULT goes red, worker's light cuts | "ran out of budget" |
| `agent_end cancelled` | Walks straight out | "you stopped them" |
| `session_end` | Lights dim, summary card on the front desk | — |

Taint rides on the object, not the worker: a tainted result is a **red-tagged
folder** the figure carries, and the rail line says "unverified — came from
outside". The provenance gate (#22) has had no visual representation anywhere;
this is the first one.

### 5. Roles and sprites

Silhouette carries role; colour carries state. Both are always accompanied by a
word, so neither is load-bearing alone.

Role art derives from `agent_catalog`: `label` is the display name, `hint` is the
tooltip, and the sprite is chosen by a small, explicit map (`researcher`,
`summariser`, `writer`, `reviewer`, `builder`, `analyst`, `generic`), falling
back to a deterministic silhouette hashed from the agent name so an unknown
profile still looks like a distinct person. Flat SVG, three shapes per figure,
CSS transforms for motion. No sprite sheets, no engine.

Depth > 1 renders as **helpers at the same desk** — a small second figure — not
a nested floor. Same one-visual-level cap the TUI took, for the same reason.

### 6. Human verbs are the protocol's verbs

| Studio gesture | Message |
|---|---|
| Drag a role card onto an empty desk | `spawn { agent, input, budget_usd? }` |
| Fill the one-line brief on the hire card | `prompt_field` shorthand from the catalog |
| Click worker → Stop | `agent_cancel { agent_id }` |
| Green / red on the front-desk card | `tool_approve` / `tool_deny` |
| Type into a worker's speech bubble | `input_response` |
| Turn the vault dial before hiring | `budget_usd` on `spawn` |
| Pin your own note to the board | `board_post` (new, §7) |
| Say something to the whole team | `message` |

There is deliberately **no auto-approve affordance in Studio**. Approval mode is
server-authoritative already (the client's `yolo` flag is ignored); a game layer
that made blanket approval one satisfying click would be the single most
dangerous thing in this design.

### 7. The bulletin board and the standup

This is the one genuine runtime addition. One primitive, three faces.

#### 7.1 The primitive

```ts
// src/agents/bulletin.ts — session-scoped, append-only, in-memory + ledger.
export interface BulletinPost {
  id: string
  seq: number                       // monotonic per session; the only ordering
  session_id: string
  from_agent_id: string             // 'operator' when the human posts
  from_agent_name: string
  to: 'all' | string[]              // agent_ids; 'all' is the public board
  kind: 'post' | 'ask' | 'answer' | 'handoff' | 'standup'
  subject: string                   // <= 120 chars, this is the card title
  body: string                      // <= 2 KB
  artifact_ids?: string[]
  tainted: boolean
  taint_sources?: string[]
  ts: number
}
```

Exposed as two ordinary builtin tools, so ACL, provenance, audit, telemetry, and
undo all apply for free and there is no second policy surface:

- **`Post`** — `{ subject, body, to?, kind?, artifact_ids? }`
- **`Board`** — `{ since_seq?, mine_only?, subject_contains?, limit? }`

Profile control is the existing shape: `tools.builtin.Post: allow | prompt | deny`.
A profile that omits them is unchanged — the whole feature is additive and off
for any agent whose ACL does not grant it.

#### 7.2 Delivery is pull at a turn boundary, never an interrupt

At the start of a child's next turn, unread posts addressed to it (or to `all`)
are injected as a single delimited, clearly-untrusted block, capped at N posts
and M bytes, exactly the way inbound channel content is already treated under
#22. There is no push, no interrupt, and no re-entrancy.

That one choice buys termination: an agent cannot be woken by a message, so no
cycle of A→B→A can run without each hop consuming a turn against a budget that
is already bounded. No deadlock detection, no delivery retries, no mailbox GC.

#### 7.3 Caps

| Cap | Value | Why |
|---|---|---|
| Posts per agent per turn | 5 | Stops a chatty model turning the board into a log |
| Body | 2 KB | The board is for claims and pointers, not payloads — bulk goes to artifacts |
| Board per session | 200 posts | Oldest elide to restorable handles, exactly as context projection does |
| Subject | 120 chars | It is a card title; if it does not fit on a card it is not a subject |

Over-cap is a refusal with numbers in a `notice`, matching the budget refusal
style in ADR-43 — never a silent drop.

#### 7.4 Taint merges on read, monotonically

Reading the board merges the taint of every post returned into the reading
turn's provenance. A clean agent that reads a tainted post becomes tainted.

This is the load-bearing safety property. Without it the board is a laundering
machine: a child that fetched an untrusted web page could post its contents and
a clean sibling could act on them with full privileges. `Board`'s `ToolReturn`
carries `provenance` and `taintSources` the same way every other ingesting tool
already does.

#### 7.5 The standup

A standup is a **synchronisation point, not a conversation**. Two triggers:

1. **Join** — when a `runBoundedPool` batch settles, the parent opens a standup
   automatically: each child's validated output (or its contract violation) is
   posted as `kind: 'standup'`, one card each, and the parent reads them in one
   pass. This event already happens; today it is invisible.
2. **Explicit** — a `Standup({ agents, question })` tool on the parent. Each
   named *live* child receives the question at its next turn boundary, answers
   with one post, and the parent proceeds when all have answered or the timeout
   fires.

Bounds, all non-negotiable:

- **One round.** A standup answer cannot open a standup. No recursion, no depth.
- **Timeout closes it.** Late answers are posted to the board but do not reopen
  the standup; the parent sees who did not answer.
- **Budget is charged to the answerer**, from its own remaining slice (ADR-43).
- **Dead agents are skipped**, named as such, not waited on.

On the floor this is the moment the whole design exists for: the named figures
walk to the meeting table, each drops a card, the cards fan onto the board, and
everyone returns to their desk. Someone who has never seen a terminal
understands instantly that the work just came back together.

### 8. Protocol delta — version 4

```ts
// src/types.ts — mirrored into studio/ and web/ by the generator (§10).
export interface BulletinPostWire {
  id: string; seq: number; from_agent_id: string; from_agent_name: string
  to: 'all' | string[]; kind: 'post' | 'ask' | 'answer' | 'handoff' | 'standup'
  subject: string; body_preview: string      // <= 240 chars; full body via Board
  artifact_ids?: string[]; tainted: boolean; ts: number
}

// ServerMessage additions
| { type: 'agent_message'; post: BulletinPostWire; run_id?: string }
| { type: 'standup'; standup_id: string; phase: 'open' | 'answered' | 'closed'
  ; subject: string; expected: string[]; answered: string[]; run_id?: string }
| { type: 'fleet_snapshot'; frames: AgentFrame[]
  ; states: { agent_id: string; tool?: string; since: number
            ; state: 'running' | 'waiting_approval' | 'waiting_input'
            ; spend_usd: number; tools: number }[]
  ; board: BulletinPostWire[]; stage?: Stage
  ; queue: { id: string; kind: 'tool_prompt' | 'input_request'; agent_id?: string }[]
  ; run_id?: string }

// ClientMessage additions
| { type: 'board_post'; subject: string; body: string; to?: string[] }
| { type: 'attach'; session_id: string; mode: 'observe' | 'control' }   // see OQ1
```

`PROTOCOL_VERSION = 4`. Degradation follows the branch already established in
`tagEvents`: a client that says 3 never receives `agent_message`, `standup`, or
`fleet_snapshot`, and sees a byte-identical stream to today. The bulletin still
functions server-side for such a client — the agents can use it, the operator
just cannot see it. A regression test pins this, as protocol 2 is pinned now.

`AgentLoopEvents` gains two optional callbacks — `onAgentMessage(post)` and
`onStandup(...)` — tagged through `tagEvents` under the same `compatible` guard
as every other v3 callback.

### 9. Reconnect and replay

`fleet_snapshot` is sent on connect and on `attach`, before the live tail. The
reducer's contract is:

```
reduce(snapshot) then reduce(tail)  ≡  reduce(entire history)
```

as an actual test over a recorded fixture. Without it, a reconnect mid-fan-out
leaves ghost workers at desks whose agents finished while the socket was down —
the exact failure that makes live dashboards untrustworthy.

Replay falls out for free: point the reducer at a stored run's events, drive the
choreographer from a scrubber instead of a socket, and Studio plays the run back
as a film. That is the honest version of what `films.ts` hand-authors for the
docs today.

### 10. Package shape

Studio ships as a standalone app in the workspace — not inside `web/`.

```
studio/
  index.html
  package.json                 name: harness-studio; vite + react + vitest only
  src/
    protocol.ts                GENERATED — do not edit
    net/socket.ts              ws, hello{protocol_version:4}, reconnect + snapshot
    scene/reducer.ts           ServerMessage → SceneState        (pure)
    scene/choreographer.ts     SceneState → Beat[]               (pure + clock)
    scene/floorplan.ts         rooms, desks, paths               (pure data)
    scene/roles.ts             agent_catalog → silhouette + accent
    scene/language.ts          the eight status words, one place
    ui/Floor.tsx               SVG stage
    ui/Worker.tsx              figure, status word, bubbles, taint tag
    ui/Board.tsx               bulletin cards + standup table
    ui/FrontDesk.tsx           approval + question queue
    ui/Vault.tsx               spend meter, budget ring
    ui/Rail.tsx                plain-English feed — also the a11y fallback
    ui/HireCard.tsx            catalog → drag to desk → spawn
    ui/Drawer.tsx              per-agent transcript (prose lives here only)
  tests/
```

- `pnpm-workspace.yaml` gains `"studio"`. Three packages become four.
- **Protocol types are generated, never copied.**
  [`scripts/gen-web-protocol.mjs`](../../../scripts/gen-web-protocol.mjs) becomes
  `gen-protocol.mjs` with two targets (`web/lib/protocol.ts`,
  `studio/src/protocol.ts`); `--check` keeps both honest in CI. One generator is
  the whole reason a separate app does not become a drifting fork.
- **Vite, not Next.** Studio is a live socket app with no SSR, no routing, and no
  server component story. Next would add a build surface for nothing.
- **No game engine.** React + SVG + CSS transforms. If it ever needs Pixi, the
  scene model is renderer-agnostic and that is a swap, not a rewrite.
- **Boundary guard.** `scripts/check-boundary.sh` scans `src/` only, so a new
  top-level package does not trip it. `src/agents/bulletin.ts` must keep to
  generic vocabulary — "board", "post", "standup" are fine; no product or vendor
  names.

### 11. Legibility and accessibility rules

These are requirements, not polish, and each has a test.

1. **Eight words, one file.** Worker status comes from a closed vocabulary in
   `scene/language.ts`: thinking · reading · building · looking things up ·
   needs your OK · asking you · waiting · finished. Tool names never appear on
   the floor. They appear in the drawer, in full, unedited.
2. **Colour is never the only carrier.** Every state has a word and a glyph.
   Palette is checked for deuteranopia/protanopia contrast.
3. **No prose on the floor.** Tokens stream in the drawer only — the fleet
   spec's resolved question 3, for the same bounded-render-cost reason.
4. **Reduced motion is a first-class path.** `prefers-reduced-motion` snaps
   positions, keeps every state change, and the rail becomes primary. Same
   pattern `UseCaseFilm.vue` uses with its storyboard `<ol>`.
5. **The rail is complete.** Every beat that reaches the floor also reaches the
   rail as one plain sentence. A screen-reader user loses no information, and
   the rail is the audit trail when someone asks "what happened at 3pm".
6. **Danger is never softened.** `risk: 'danger'` renders the gate red, the card
   red, and the full arguments visible before the buttons.
7. **Nothing is hidden behind a hover.** Touch and keyboard reach every control.

### 12. Onboarding

#30 shipped guided install; Studio is the natural first screen after it. First
run opens an empty floor with one hire card and one suggested task. Hiring the
first worker and watching it walk to the library *is* the tutorial. No modal
tour, no coach marks — the floor teaches itself because it is a place.

---

## Safety review

| Concern | Resolution |
|---|---|
| Board as a taint-laundering path | `Board` merges taint monotonically into the reading turn; permanent red-team fixture (ADR-51 style) |
| Board as an agent-to-agent prompt-injection vector | Injected posts are wrapped as untrusted delimited content, identical treatment to inbound channel data (#22); an agent's ACL is never widened by something it read |
| Standup fan-in multiplying spend | One round, no recursion, hard timeout, each answer charged to the answerer's own budget slice (ADR-43) |
| Board unbounded growth | Per-session cap with elision to restorable handles; per-agent per-turn cap refused with numbers |
| Game layer making approval feel trivial | No auto-approve affordance; real tool + real arguments on every card; danger renders red at the gate and on the card |
| Studio as a second client bypassing policy | Same `hello` handshake, same server-authoritative approval mode; the client `yolo` flag is already ignored |
| Cute animation masking a failure | Choreography rule 4 — the scene may drop motion, never a state change; failures leave a persistent seat marker |
| Operator spawn from a drag gesture | Unchanged path: `spawn` inherits the parent turn's taint, `origin` stays audit metadata only (ADR-50) |
| A second observer seeing another user's session | `attach` is scoped by `userId` exactly as `resume` is; cross-user attach is a 404, with a test |

## Test plan

- `tests/bulletin.test.ts` — append-only `seq` ordering; per-turn, body, subject
  and board caps refuse with a numbered notice; elision preserves handles.
- `tests/bulletin-taint.test.ts` — **permanent red-team fixture**: a tainted
  agent posts, a clean sibling reads, the sibling's turn is tainted and a
  danger-gated tool is refused.
- `tests/standup.test.ts` — one round only; an answer cannot open a standup;
  timeout closes and names non-answerers; a dead agent is skipped not awaited;
  budget attributed to the answerer.
- `tests/protocol-v4.test.ts` — a client announcing protocol 3 receives a
  byte-identical stream; the bulletin still functions for its agents.
- `tests/fleet-snapshot.test.ts` — snapshot + tail equals full replay,
  server-side.
- `studio/tests/reducer.test.ts` — recorded fan-out fixture → expected
  `SceneState`; the same equivalence asserted client-side; seats are stable for
  an agent's life and freed on `agent_end`.
- `studio/tests/choreographer.test.ts` — 50 events in 100 ms produce ≤ 6 beats;
  lag never exceeds 2 s; a `tool_prompt` reaches the queue in the same frame it
  arrives, under a saturated beat queue.
- `studio/tests/language.test.ts` — every `Worker.activity` maps to one of the
  eight words; no tool name can reach a floor label.
- `studio/tests/a11y.test.ts` — reduced-motion renders every state change; every
  worker exposes a text status; no control is hover-only.
- `scripts/gen-protocol.mjs --check` in CI for both targets.

## Risks

| Risk | Mitigation |
|---|---|
| The floor is charming for a day and useless by week two | The console toggle exists from day one; if operators live in the console, that is a real answer and Studio stays the onboarding face |
| Standalone app drifts from the protocol | Types are generated from `src/types.ts` with a `--check` gate; hand-copying is forbidden |
| A separate app cannot watch the run the user actually started | Open question 1 — resolve `attach` **before** building the app, not after |
| Bulletin becomes a chat and burns budget | Per-turn cap, 2 KB body, pull-only delivery, and a board that is visibly a *board* — cards, not a transcript |
| Non-technical framing hides a real risk | Legibility rule 6 and the no-auto-approve rule; the safety review is a review gate, not a section |
| Scene reducer duplicates `harnessReducer` logic | Studio's reducer owns the *agent axis only*; message-list concerns stay in the web reducer, and the console renderer reads `SceneState` rather than reimplementing it |
| Art becomes the critical path | Silhouettes are three SVG shapes with a deterministic fallback; no sprite commission blocks the build |

## Proposed ADRs

> ADR-78…ADR-81 are reserved by the agent-fleet plan and still unwritten;
> these continue from 82 to avoid a collision.

- **ADR-82 — Studio is a pure renderer over the event stream.** `SceneState` is
  `f(ServerMessage[])`. No side channel, no scraping, no client-side inference of
  parentage. This is what lets a second surface exist without a second truth.
- **ADR-83 — One bulletin primitive; direct messages and standups are views of
  it.** Separate mailbox and broadcast subsystems would mean two taint rules and
  two visualisations of the same act.
- **ADR-84 — Board delivery is pull-at-turn-boundary, never an interrupt.**
  Termination is bought by construction rather than by cycle detection.
- **ADR-85 — Reading the board merges taint monotonically.** Without this the
  board is a privilege-laundering channel between siblings.
- **ADR-86 — A standup is one bounded round, not a conversation.** Multi-round
  negotiation between agents is unbounded spend with no operator in the loop.
- **ADR-87 — Truth outranks choreography.** Under load the scene fast-forwards;
  it never queues, delays, or reorders a state change, and never an approval.
- **ADR-88 — Studio ships as a separate package with a generated protocol
  mirror.** One generator, two consumers; a hand-copied type is how the Go client
  nearly drifted and is not repeated.

## Open questions

1. **How does Studio watch a session it did not start?** This is the blocking
   one. `resume` loads a persisted session into the calling connection; it does
   not subscribe to another connection's live turn
   ([`src/server/index.ts:986`](../../../src/server/index.ts)). A standalone app
   therefore owns its own session today, which means "open Studio and watch what
   the TUI is doing" does not work. Proposal: an `attach { session_id, mode }`
   verb that registers the socket as an additional sink on the existing session's
   event fan-out, with `observe` (read-only) and `control` (may approve, answer,
   spawn, cancel) modes, scoped by `userId`. Needs a decision on what happens
   when two `control` clients answer the same approval — first-writer-wins with a
   "someone else answered this" notice is the cheap answer. **Resolve before
   Sprint 1.**
2. **Is the human a figure on the floor or the room itself?** Currently the front
   desk is furniture. Making the operator a seated figure would let workers walk
   up to *you* and let you post to the board as a peer — better as a metaphor,
   but it invites "the agent asked the human a question" to look like ordinary
   chatter rather than a blocking ask. Leaning: keep the front desk as a place,
   render the human's board posts with an operator badge.
3. **Board scope — session or project?** A project-scoped board would let a
   scheduled overnight run leave notes for the morning session, which is
   genuinely useful and pairs with #19 temporal memory. It also lengthens the
   taint lifetime and needs a real TTL and retention story. Proposal: ship
   session-scoped, design the store so the scope key is a parameter.
4. **Does the console renderer get built now or later?** The claim "same reducer,
   two renderers" is only proven when the second one exists. Cheapest proof is a
   thin lanes view inside Studio itself rather than retrofitting `web/`.
5. **Replay in v1?** It is nearly free given the pure reducer, and it is the best
   demo the project has. But it needs a stored event log per run, which
   `src/runs/store.ts` does not keep today.
