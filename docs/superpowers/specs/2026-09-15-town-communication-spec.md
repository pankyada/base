# Town communication acceptance specification

Date: 2026-09-15. Task: PT-063. Status: approved by user for implementation on 2026-09-15.

Primary feature: ORCH-04. Related features: ORCH-03, ORCH-06, ORCH-08. Affected client: Web `/town`. Core compatibility: reuse existing Town task, message, snapshot, and SSE contracts. No new authority, model call, quota bypass, workspace policy, wire protocol, or TUI work is in scope.

## Outcome

Town communication feels appropriate to a Chola-era Tamil settlement around 1000 CE. A resident or house carries only a tiny brass-rim speech marker when it has something for the user. The map remains a map. Opening it shows one palm-leaf folio with the real durable conversation, task state, and actions.

The Town Hall opens the same folio for actual agent-to-agent correspondence. A submitted task makes its resident look occupied only when persisted task/runtime linkage supports that claim. Brief preparation gestures may make dispatch feel alive, but are labelled preparation and cannot impersonate a running agent.

## Existing contract is authoritative

- `TownMessage` persists `status`, `question`, `answer`, and `handoff`, including sender, recipient, project/task/thread, delivery state, revision, timestamp, and optional `answer_outcome`.
- `TownAsk` and approval both persist a question, create matching pending input, and move the exact task to `waiting_user`.
- An answer is persisted before its continuation attempt. Its receipt is either `resumed: true` with a state, or `resumed: false` with the held/failed reason. Reusing an answer key returns the original receipt and cannot resume twice.
- Working animation requires the same persisted task, agent, session, and run linkage, with task state `running`. Queue, assignment, unknown, failure, and completion do not mean working.
- PT-054 is non-negotiable: a restart/missing exact assistant tool-call preimage makes continuation unsafe. The user can see the saved answer and refusal evidence, but the UI cannot reconstruct or claim a resume.

## Canvas language

The main canvas has no transcript, task list, or floating dashboard. It permits one camera-facing compact marker per relevant resident or project home.

| Durable condition | Canvas marker | Accessible label |
|---|---|---|
| Open question or approval for user | tiny brass-rim `?` bubble | Open question from agent |
| Linked running task | tiny brass-rim `…` bubble | Agent is working on task |
| Blocked, failed, or unsafe continuation | tiny brass-rim `!` bubble | Agent needs attention; open exact state |
| New direct status/handoff to user, queue, idle, complete, unknown | folded palm-leaf bubble for unread direct message; otherwise no marker | Open message from agent, or no implied alert/progress |

Several relevant records at one anchor aggregate into exactly one marker with a bounded count and priority `?`, `!`, `…`, then folded leaf. It never stacks markers, covers a house, or exposes message text on the map. It is clickable, keyboard reachable, and legible in day/night modes.

The active work loop is a subtle, nonliteral Chola-era gesture: writing on palm leaf, measuring, sorting scrolls, or consulting a folio. `dispatching` may show a short unsealing/preparation gesture and the exact state “Preparing dispatch.” Queued states use a quiet waiting pose and show their actual reason only in the folio. Linked `running` alone loops. `waiting_user` stops work, raises a hand, and shows the question marker. Terminal states stop. Reduced motion freezes all cosmetic work/preparation while preserving state.

## One palm-leaf folio

Clicking a marker, resident, project, or Hall correspondence opens one folio; opening another replaces its content. The approved layout is a compact side folio on desktop and near-full-height sheet on narrow screens. The map stays behind it without competing persistent communication panels.

The folio shows exact lifecycle state before prose. Conversation is ordered by persisted time and shows sender, recipient, kind, and delivery/acknowledgement separately. Routine adjacent status posts may collapse, preserving a count and expansion. Questions and handoffs stay expanded and discoverable. The folio alone contains bodies, task prompt, run/session identifiers, queue/terminal evidence, and actions. It has close/focus/keyboard behavior and returns the user to the selected anchor. Desktop uses a side folio; narrow screens use a near-full-height sheet.

## Answer and approval lifecycle

For an open question, pin the exact question above its composer. Honor its text/select/multiselect form. Approval questions use explicit inline Allow and Deny controls; free text cannot masquerade as approval.

After submit, show immediate local feedback and replace it with the persisted server receipt:

1. **Sending**: request in flight; duplicate submit disabled.
2. **Received — resuming**: answer recorded and `resumed: true`, `state: running`; only now can the resident work loop begin.
3. **Received — queued**: answer recorded and continuation held, with actual state such as `queued_quota` and the real reason; agent is not shown as working.
4. **Saved — could not resume**: answer exists but continuation failed/is unsafe; show exact returned error and task state/evidence.
5. **Delivery unconfirmed**: timeout, connection loss, or other request failure without a durable receipt; retain the draft and offer a refresh/retry, never say it was definitely not sent or definitely delivered. A confirmed validation/revision error may instead say that the server rejected the request.

Refresh, SSE reconnection, reopening the folio, and repeat answer requests render the durable receipt, not a new Sending state or a second resume. Delivery acknowledgement is distinct from continuation outcome; it never implies a model call ran.

## User-to-agent and council flows

Task submission shows a compact receipt in its initiating folio: task created, then actual persisted `ready`, queue reason, `dispatching`, or `running`, plus assigned resident if any. Preparation is allowed only during bounded dispatching. The loop begins only after the start result records session/run linkage. A held or failed task stays truthful and still.

User direct messages are durable `TownMessage` records. They say delivered only after POST succeeds and acknowledged only after the separate acknowledgement record. A direct message alone does not resume or steer a parked worker.

Town Hall **Council correspondence** filters the same folio to persisted agent-to-agent messages for the selected project/task/thread. It groups by task/thread; gives handoffs and questions priority; shows exact sender and recipient; and may collapse repetitive status updates. It must never invent dialogue, infer a discussion from task state, or turn an internal status into a user request.

## Acceptance cases

1. Linked running fixture: resident loops; folio opens matching task; no canvas transcript.
2. `waiting_user` fixture: work stops, raised-hand attention and one marker appear; folio pins real question and correct answer/approval control.
3. Successful answer: Sending to Received — resuming, then SSE running/work; reload retains receipt.
4. Quota-held answer: Sending to Received — queued with `queued_quota` reason; no work; later same-folio SSE update can resume it.
5. PT-054 unsafe/missing continuation or failure: saved answer and exact refusal/evidence shown; no unsafe resume action exists.
6. Timeout/connection loss before receipt: draft remains, Delivery unconfirmed shown, no delivered/working claim; a subsequent snapshot may reveal the persisted answer. A confirmed revision error is shown as rejected.
7. Submission: preparation only during dispatching; linked started result activates work; queued/failed result does not.
8. Hall fixture: actual statuses/questions/handoffs grouped by task/thread, real identities shown, only repetitive statuses collapsed.
9. Multiple unread records: one bounded aggregate marker, keyboard activation, filtered folio, no body on canvas.
10. Day/night, desktop/narrow, keyboard, and reduced-motion checks retain access and truthful state.

## Verification and limits

Add focused model/scene/client tests for those states; run Web suite, typecheck, and build. Browser acceptance must exercise running, resumed answer, queued receipt, unsafe/failed receipt, and Hall messages via snapshot/SSE. Live provider/quota and release acceptance remain separate.

Out of scope: queue-wake changes, fixing missing assistant-call preimages, synthesized conversations, automatic retry, new task authority/message kinds, separate canvas chat UI, or changing Core task/quota/workspace gates.
