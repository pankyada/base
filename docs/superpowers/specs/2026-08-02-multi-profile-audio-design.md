# Multi-Profile Server & Audio Transport — Design (H7)

> Date: 2026-08-02
> Status: Draft (design)
> Related: `docs/superpowers/specs/2026-08-02-channels-design.md`,
> `docs/superpowers/plans/2026-08-02-personal-assistant-plan.md`, `docs/ROADMAP.md`

## Goal

Two unrelated-looking limits that both block the same thing, and so are specified
together.

**One process, one profile.** The server loads a single profile and every
connection gets it. An assistant is inherently several agents — a cheap brief
generator on cron, a triage worker on a poll, a conversational front end, a
guarded dev delegate — with different models, ACLs, budgets, and triggers. Today
that means one process per profile: N ports, N supervisors, N sets of MCP
subprocesses, and no shared session or memory view.

**The protocol is text-only.** `ServerMessage`/`ClientMessage` carry tokens,
tools, and control. Voice is a v1 requirement for the assistant product, and
voice is not "text with a microphone attached": it needs streaming audio in both
directions, partial transcripts, endpointing, and interruption — none of which
can be expressed today.

Both are harness-shaped gaps. Neither requires a vendor in core.

### Non-goals

- **No STT/TTS provider in core.** Interfaces only; providers ship as product
  plugins, exactly like channel adapters. `package.json` gains no audio vendor.
- Not multi-tenancy. Multiple profiles for *one operator*, not isolated
  customers. Hosting is A9 and needs a different threat model.
- Not a process supervisor. Profiles share one process; crash isolation between
  profiles is explicitly not claimed (§3).
- Not a media server. No transcoding, no recording, no storage of audio beyond
  the ephemeral scratch needed to hand a file to a provider.

---

# Part 1 — Multi-profile server

## 1. Loading

```
harness serve --profiles ./profiles           # directory
harness serve --profile ./profiles/coding.yaml # single, unchanged behavior
```

A profile directory loads every `*.yaml`, validates each, and registers it by
`name`. One invalid profile logs and is skipped; it does not prevent the others
from serving. Single-profile invocation keeps today's exact semantics — that is
the back-compat guarantee, and existing tests must pass untouched.

`--default-profile` names the fallback; otherwise the first alphabetically, with
a startup warning if more than one is loaded and none is marked default.

## 2. Routing

A connection or request resolves to a profile through one of four paths:

| Entry | Resolution |
|---|---|
| WS `hello` | `hello.profile` (new optional field) → default |
| REST `/run`, `/stream` | `?profile=` or body `profile` → default |
| Trigger (cron/watch/poll) | the profile that declared the trigger |
| Channel inbound (H1) | binding table's `profile` |

`ClientMessage` gains `{ type: 'set_profile'; profile: string }` so a client can
switch without reconnecting, mirroring the existing `set_model`. `session_ready`
already carries `profile`; clients that ignore the new field are unaffected.

Unknown profile name ⇒ explicit error listing available profiles, never a silent
fallback to default. Silently serving a different agent than requested is the
worst possible failure here.

## 3. What is shared and what is not

| Shared across profiles | Isolated per profile |
|---|---|
| HTTP/WS server, port 7337 | sessions and their ledgers |
| Process, event loop | memory scopes (`profile`, `project`) |
| Model registry, telemetry writer | MCP client set and subprocesses |
| Channel adapter instances | tool registry view + ACL resolution |
| Audit journal (tagged by profile) | trigger managers, budgets |
| Skills discovered from disk | system prompt, model roles, workflow config |

Memory scoping is the subtle one. `user` scope stays shared across profiles —
"my timezone is IST" should not be relearned per agent. `profile` and `project`
scopes stay isolated. This split already exists in `FsMemoryProvider`; multi-
profile makes it load-bearing, so it gets an explicit isolation test: a fact
written by `triage` in `profile` scope must be invisible to `brief`.

**Not claimed: crash isolation.** One process means one blast radius. An MCP
subprocess that wedges affects only its owning profile; an unhandled exception in
the loop does not. Operators wanting hard isolation run separate processes, and
the docs say so plainly rather than implying a guarantee that does not exist.

## 4. Resource management

- MCP servers connect **lazily** on first use per profile, not at boot. Booting
  six profiles that each spawn four stdio MCP servers is 24 subprocesses before
  a single message arrives.
- Idle MCP connections close after `mcp.idle_timeout_s` (default 900) and
  reconnect on demand.
- `triggers.max_concurrent_runs` (H4 §5) is enforced **globally**, not per
  profile, or six profiles each politely capped at 3 becomes 18 concurrent runs
  on a Mac mini.
- Model clients are pooled by `base_url` + key, shared across profiles.

---

# Part 2 — Audio transport

## 5. Protocol additions

```ts
// client → server
| { type: 'audio_start'; codec: 'opus'|'pcm16'; sample_rate: number }
| { type: 'audio_chunk'; seq: number; data: ArrayBuffer }   // binary frame
| { type: 'audio_end' }
| { type: 'barge_in' }

// server → client
| { type: 'transcript_partial'; text: string; final: boolean }
| { type: 'audio_out_start'; codec: 'opus'|'pcm16'; sample_rate: number }
| { type: 'audio_out_chunk'; seq: number; data: ArrayBuffer }
| { type: 'audio_out_end'; reason: 'complete'|'interrupted'|'error' }
```

- **Binary WS frames** for audio; the JSON control messages carry only metadata.
  Base64 exists solely on the REST fallback path, where latency already lost.
- Capability negotiation in `hello`: `audio_supported: true`. Text-only clients
  (TUI, CLI, existing web) are unaffected and receive no audio messages.
- `seq` enables gap detection; out-of-order chunks are dropped rather than
  buffered indefinitely.

## 6. Provider interfaces

```ts
// src/voice/types.ts
export interface SpeechToText {
  readonly name: string
  transcribe(stream: AsyncIterable<Uint8Array>, opts: {
    sample_rate: number; codec: string; language?: string; signal?: AbortSignal
  }): AsyncIterable<{ text: string; final: boolean }>
}

export interface TextToSpeech {
  readonly name: string
  synthesize(text: AsyncIterable<string>, opts: {
    voice?: string; sample_rate: number; signal?: AbortSignal
  }): AsyncIterable<Uint8Array>
}
```

Both are **streaming in and streaming out**. A batch-oriented interface would
foreclose acceptable latency permanently, and every provider worth using is
streaming. Providers load from `.agents/voice/**` via the same loader pattern as
tools and channels.

Profile surface:

```yaml
voice:
  stt: { provider: deepgram-stream, config: { key_env: DEEPGRAM_KEY } }
  tts: { provider: elevenlabs-stream, config: { key_env: ELEVEN_KEY, voice: "..." } }
  fallback: { stt: whisper-local }
  endpointing: { silence_ms: 700, max_utterance_s: 60 }
  barge_in: true
```

`config` is opaque to core, validated by the provider — identical rule to
channels.

## 7. The turn loop

```
mic ──audio_chunk──▶ STT stream ──partial──▶ transcript_partial (client shows it)
                                  └─final──▶ agent turn begins
                                              │
        first sentence boundary ◀─token stream┘
                    │
                    ▼
        TTS synthesize(sentence stream) ──▶ audio_out_chunk ──▶ speaker
```

Two latency-critical behaviors:

- **Sentence-level chunking.** TTS starts on the first sentence boundary, not on
  turn completion. Waiting for a full answer costs seconds of dead air and is the
  single biggest quality difference between voice assistants.
- **Endpointing** is provider-side where available, with a core silence-timer
  fallback. `max_utterance_s` bounds a stuck-open mic.

### 7.1 Barge-in

Interruption must cancel three things atomically:

1. TTS synthesis (`signal.abort()`),
2. audio playback (client-side, on `audio_out_end: interrupted`),
3. **the in-flight LLM turn** — otherwise the model keeps generating an answer to
   a question the human has abandoned, and bills for it.

Ledger integrity on interruption: the partial assistant message is appended
**marked as interrupted**, not discarded. The model must see that it was cut off
mid-sentence; otherwise the next turn's context claims it said something it never
finished saying. The append-only ledger (#16) makes this natural — it is a normal
append with a flag, not a rewrite.

Target: interruption stops audio within 200ms.

## 8. Voice register

Voice output needs different shaping than text — short sentences, no markdown, no
bullet lists, one question at a time. Core provides the *hook*, not the content:
a profile may declare `system_prompt_voice` used when the active channel's
`capabilities.audio` is true. The actual wording is a product concern.

This is the resolution of H1's open question 2: per-modality prompt variants live
in the profile, selected by capability, with no vendor knowledge in core.

## 9. Module layout

```
src/server/index.ts        multi-profile registry, routing, set_profile
src/profiles/loader.ts     directory loading, default resolution
src/voice/types.ts         SpeechToText, TextToSpeech
src/voice/loader.ts        .agents/voice discovery (mirrors channels/loader.ts)
src/voice/session.ts       turn loop, endpointing, sentence chunking, barge-in
src/voice/fixture.ts       deterministic fixture provider for tests
src/types.ts               audio message types
web/lib/types.ts           mirrored client types
```

## 10. Testing

- **Two-profile isolation**: memory, sessions, MCP sets, budgets.
- **Single-profile back-compat**: existing server tests untouched and green.
- **Fixture voice provider**: deterministic audio in, deterministic audio out —
  full turn loop tested with no network and no vendor key.
- **Barge-in**: assert audio stops, LLM turn aborts, ledger contains an
  interrupted-marked partial.
- **Latency budgets** asserted against the fixture: first partial transcript and
  first audio-out chunk each under a fixed threshold.
- **No-vendor guard**: CI asserts `package.json` gains no audio/messaging vendor
  dependency (extends the H0.1 boundary check).

## 11. Risks

| Risk | Mitigation |
|---|---|
| One process, N profiles → one crash takes all | documented explicitly, not papered over; per-profile MCP isolation limits the common case; separate processes remain supported |
| MCP subprocess explosion | lazy connect + idle close + global concurrency cap |
| Audio latency dominated by network round trips | streaming both directions; sentence chunking; local fallback provider for offline |
| Barge-in races corrupting the ledger | interruption appends a marked partial; append-only ledger makes this safe by construction |
| Binary frames complicate existing clients | gated behind `audio_supported` in `hello`; text clients never see them |
| Voice cost surprise (per-minute billing) | audio minutes recorded in the usage ledger and subject to H5 budgets |

## 12. Open questions

1. Should profile routing allow a *chain* (assistant answers, silently delegates
   to triage) without a `Delegate` tool call? Currently no — delegation stays
   explicit and auditable.
2. Half-duplex vs full-duplex: v1 assumes half-duplex with barge-in. True
   full-duplex (both talking) needs echo cancellation and is deferred.
