# PT-063 — Town communication folio

Date: 2026-09-15. Design approved by the user; implementation in progress.
Primary ORCH-04; affected ORCH-03/06/08. Client: Web `/town`.

## Direction and approval boundary

User already requested small bubbles on houses/real agents, scroll details,
clearer reply/resume feedback, visible work and a Chola-era Indian game feel.
Approved layout: one compact side folio on desktop, near-full-height folio on
mobile. Close it to return to the unobstructed town.

Use original palm-leaf manuscript styling: warm leaf, dark ink, cord binding,
restrained brass/red. Period-inspired product art, not an authentic artifact
reconstruction; no invented inscriptions. Keep controls and state copy legible.

## Quiet canvas

Small anchored bubble: question mark for reply needed, three dots for work,
folded-leaf mark for unread result, exclamation for block. Aggregate crowded
house activity; no transcript on map. Accessible names carry full status.
One folio opens on click/keyboard without resetting camera; close/Escape restores
focus. Retain directory/landmark navigation. Errors remain reachable through
compact attention markers.

## User to agent — first implementation slice

- Conversation first: agent, exact task, current state. Repository facts, IDs,
  tool traces and quota detail behind Work record disclosure.
- Pin exact pending question above answer composer. Inline choices; approvals
  use explicit Allow action / Deny action. Replace native prompt/confirm.
- Show Sending your reply immediately. Use actual server result for Reply
  received — resuming work; Reply received — waiting for capacity/workspace;
  or Reply saved — could not resume, with detail.
- Retain question, reply and receipt after refresh. POST success does not prove
  execution. Preserve failed drafts for retry; bind submission to exact question,
  revision and continuation, with stable retry identity.
- When no question is pending, composer sends a note. Separate Delivered / Read
  by agent; never imply a note resumes a paused question.
- Resident view scopes to exact agent/task, not every project task.

## Agent to agent — second slice

Hall bubble marks real unread exchanges/requests. Hall folio has Council and Work
orders sections. Group durable messages by task/thread, with readable sender,
recipient, reply and handoff relationship. Questions/handoffs first; repetitive
status collapsed under Earlier updates. Open exact worker/project from exchange.
Small transient leaf/bubble cue may mark a real incoming exchange. No invented
dialogue, people, acknowledgment or automated routing policy.

## Visible work — third slice

Draft saved: rolled work order. Queued: waiting/preparation pose plus actual
reason in folio. Dispatching: preparation gesture distinct from running.
Matching actual running task/agent/session/run: bounded varied writing, sorting
palm leaves, moving ledger a few steps and returning. Decorative movement need
not mirror tool calls. Waiting: stop, turn outward, raise hand/question bubble.
Completed: brief settling gesture then still/unread-result mark. Stale, unknown
and failed states never animate working. No synthetic agents. Reduced motion
freezes loops and retains static cues.

## Findings and compatibility

`town-client.tsx` uses native prompt/confirm and ignores answer outcome fields;
its message DTO omits durable `answer_outcome`. Core already returns `resumed`,
`state`, `resume_error`. Notes get acknowledgment through TownRead. Resident cards
currently derive every project task. Scene already enforces matching runtime
linkage; preserve it. PT-054 unsafe workflow continuation must remain visible
failure, never UI-success. Preserve quota, approval and workspace gates.

Expected Core compatibility: none; reuse Town REST/SSE/persisted receipt fields.
No TUI/API/schema/prompt change planned. Specify any missing shared contract
before changing it.

## Delivery and validation

1. Confirm remaining layout; Terra completes acceptance spec.
2. Capture scoped pre-edit backup/hashes and dirty state; preserve unrelated work.
3. Luna writes meaningful failing tests then implements slices above.
4. Test exact scoping, all receipts, duplicate/retry, refresh persistence, note
   acknowledgment, real exchange grouping, valid work linkage/reduced motion.
5. Isolated fixture browser: desktop/mobile, keyboard focus, Day/Night, compact
   canvas, camera retention and state transitions. No dispatch to live workers
   solely to demonstrate decorative behavior.
6. Focused Town tests, affected Core/Web typechecks, Web build, root boundary
   guard and full root suite before commit. Record actual evidence separately
   from live/user acceptance. No commit/release/deployment implied.

Likely files: `web/app/town/town-client.tsx`, `town-scene.tsx`,
`town-world-model.ts`, `town.css`, `web/tests/town-ui.test.ts`, `town-model.test.ts`.
Read Core Town types/HTTP/store for receipt semantics.
