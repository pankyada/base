# Channels — Design (H1)

> Date: 2026-08-02
> Status: Draft (design)
> Related: `docs/superpowers/plans/2026-08-02-personal-assistant-plan.md`,
> `docs/superpowers/specs/2026-08-02-deferred-asks-design.md`, `docs/ROADMAP.md`

## Goal

The harness can only speak when someone is already listening. Every output path
— `onToken`, `onToolStart`, `onInputRequest` — is a callback owned by an attached
client. Triggered runs (#5) construct these callbacks as no-ops
(`src/scheduler/cron.ts:60-64`): a cron agent runs, spends tokens, and its output
goes nowhere. `onToolPrompt: async () => false` means it also auto-denies every
`prompt`-ACL tool it touches.

So the harness today has three unstated limitations:

1. **No egress.** An agent cannot reach a human who is not currently connected.
2. **No ingress except WS/REST.** The only ways in are a socket and an HTTP call.
3. **Unattended runs are second-class.** They cannot ask, cannot report, cannot
   be approved — they can only succeed silently or fail silently.

A **channel** is a named, pluggable, bidirectional transport between a profile
and a human. Adding one is the difference between a tool you invoke and an agent
that participates in your day. This design adds the interface, the registry, the
loader, the routing, and two vendor-free reference adapters — and nothing else.

### Non-goals

- **Not an integration layer.** A channel carries messages. It does not read
  mail, parse calendars, or know what a "contact" is. Those are MCP servers.
- **Not a new protocol.** Channels adapt *to* the existing `ClientMessage` /
  `ServerMessage` vocabulary. No parallel event system.
- **Not a message queue.** No fanout, no topics, no delivery guarantees beyond
  "the adapter reports whether send succeeded".
- **No vendor in core.** Core ships `stdout` and `webhook`. Telegram, WhatsApp,
  voice, SMS are all out-of-tree adapters loaded from `.agents/channels/`.
- **Not a notification policy engine.** *When* to notify is the agent's job
  (prompt, skill, playbook). Core only provides the verb.

---

## 1. What core knows vs what the adapter knows

The boundary is the whole design. Get it wrong and every messaging vendor's
semantics leak into `src/`.

| Concern | Owner |
|---|---|
| Message text, urgency, button labels | **core** |
| Chunking to a 4096-char limit, markdown dialect, emoji | adapter |
| "This identity is bound to user `pankaj`" | **core** (binding table) |
| What an identity string *looks like* (`chat_id`, JID, phone) | adapter |
| Approval semantics (allow / deny / always) | **core** |
| Inline keyboards vs quick replies vs numbered text menu | adapter |
| Retry, backoff, reconnect | adapter |
| Which profile/session an inbound message routes to | **core** |
| Auth to the vendor, tokens, webhooks | adapter |

Core's mental model of a channel is exactly: *a thing with a name that can send
a `ChannelMessage` and can emit `InboundMessage`s.* Nothing else.

---

## 2. Interface

```ts
// src/channels/types.ts

export interface ChannelCapabilities {
  text: boolean          // always true
  rich: boolean          // markdown / formatting survives
  buttons: boolean       // structured choices, else degrade to numbered text
  files: boolean
  audio: boolean         // see H7 — audio transport
  max_chars?: number     // core chunks to this before handing over
}

export interface ChannelMessage {
  text: string
  urgency?: 'low' | 'normal' | 'high'
  buttons?: { id: string; label: string }[]
  files?: { path: string; name?: string }[]
  /** Correlates a reply to a prompt/ask. Adapter echoes it back verbatim. */
  correlation_id?: string
}

export interface InboundMessage {
  /** Vendor-opaque stable identity of the sender. Core never parses it. */
  identity: string
  text: string
  /** Set when the human answered a specific prompt (button press, reply-to). */
  correlation_id?: string
  button_id?: string
  files?: { path: string; name?: string }[]
  audio?: { path: string; mime: string; duration_s?: number }
  received_at: string
}

export interface ChannelAdapter {
  readonly name: string
  readonly capabilities: ChannelCapabilities
  /** Adapter validates its own opaque config; throws with a human message. */
  init(config: Record<string, unknown>): Promise<void>
  send(msg: ChannelMessage, to: string): Promise<{ ok: boolean; error?: string }>
  start(onInbound: (msg: InboundMessage) => Promise<void>): Promise<void>
  stop(): Promise<void>
}
```

Two deliberate choices:

- **`identity` is opaque.** Core stores and compares it; it never parses,
  formats, or validates it. This is what keeps `chat_id` out of `src/`.
- **`correlation_id` instead of threading.** Approval and deferred-ask replies
  need to find their way home. Threading models differ wildly per vendor; a
  round-tripped opaque id works everywhere, including via a numbered text menu.

---

## 3. Registry and loader

Both mirror the tool subsystem exactly, because the tool subsystem already
solved this and a second pattern would be a second thing to learn.

- `src/channels/registry.ts` — mirrors `src/tools/registry.ts`.
- `src/channels/loader.ts` — mirrors `src/tools/loader.ts`, including
  `resolveToolsDirs()`'s four levels (user / git-root / parent / cwd), the
  `pathToFileURL` dynamic import, and last-write-wins on name collision.
  Discovers `.agents/channels/**/*.{ts,js}`.

An adapter is recognised by duck-typing (`isChannelAdapter`), same as
`isToolDefinition`. Load failures log and skip — one broken adapter must not
prevent the server from booting.

Resolution order at profile load:

```
transport name ─▶ builtin registry ─▶ loaded .agents/channels ─▶ throw
```

Throwing at **load** rather than first send is deliberate: a misconfigured
channel on an unattended box would otherwise be discovered at 7am by nothing
happening.

---

## 4. Profile surface

```yaml
channels:
  - name: phone            # profile-local handle, used by Notify
    transport: telegram     # resolved via registry
    inbound: true
    default: true           # target when Notify omits `channel`
    config:                 # opaque to core; adapter validates
      token_env: TELEGRAM_BOT_TOKEN
      mode: polling
    acl:
      notify: allow         # allow | prompt | deny — sending outward
      approvals: true       # may answer tool_prompt / input_request
      inbound: paired       # paired | open | off
    limits:
      max_sends_per_hour: 60
```

Schema notes:

- `config: z.record(z.string(), z.unknown())` — core must not gain a typed view
  of any vendor's settings. The adapter's `init()` is the validator.
- Secrets are **env var names**, never values, matching `model.api_key_env`.
- `channels` absent ⇒ current behavior byte-for-byte. `Notify` is not even
  registered (§5), so no prompt-surface change for existing profiles.
- Duplicate `name` ⇒ load error. Multiple channels of the same `transport` are
  fine (two Telegram bots, different audiences).

---

## 5. The `Notify` tool

```ts
Notify({ channel?: string, text: string, urgency?: 'low'|'normal'|'high',
         buttons?: string[] }) → string
```

- Registered **only when `profile.channels` is non-empty**. A profile without
  channels sees no new tool and pays no prompt tokens for it.
- Resolves `channel` → profile entry → adapter; unknown name returns a tool
  error naming the configured channels (recoverable by the model).
- Target identity comes from the binding table (§6) for the run's user. No
  binding ⇒ returns `[no bound recipient for channel 'phone']` rather than
  throwing — an unattended run should degrade, not crash.
- ACL: `Notify` is an ordinary builtin. It is `effect: outbound` (H6), so
  provenance gating applies to it.
- `buttons` degrade to a numbered list appended to `text` when
  `capabilities.buttons` is false.

---

## 6. Inbound routing and bindings

Core owns a persisted binding table at `~/.harness/channel-bindings.json`:

```jsonc
{
  "telegram:8367261": { "user": "pankaj", "profile": "assistant",
                        "bound_at": "2026-08-02T09:14:00Z", "label": "phone" }
}
```

Key is `<transport>:<identity>`. Value resolves the three things the server
needs: which harness user (memory/session/usage scope), which profile (H7
multi-profile), and a human-readable label for audit.

Routing an inbound message:

```
InboundMessage
  ├─ correlation_id set? ──▶ resolve pending (H2) / approval (§7) ──▶ done
  └─ else ──▶ lookup binding
              ├─ found  ──▶ resume-or-create session for (user, profile)
              │             and inject as a `message` ClientMessage
              └─ missing ──▶ acl.inbound:
                             paired ─▶ pairing flow, one reply max
                             open   ─▶ bind to profile default user
                             off    ─▶ drop silently
```

**`paired` is the default and the only sane one for an internet-reachable bot.**
An unbound identity gets at most one response, ever: a request for a pairing
code. It cannot start a session, cannot spend tokens, cannot reach a tool. The
pairing code is generated out-of-band (CLI), single-use, and expires.

Session reuse: an inbound message resumes the user's most recent session for
that profile if it is younger than `channels.session_ttl` (default 6h),
otherwise starts a fresh one. Chat has no natural session boundary; a TTL is the
least surprising rule and keeps the ledger from growing without bound.

---

## 7. Approvals over channels

Today `onToolPrompt` resolves to `false` with no client
(`cron.ts:62`). With channels:

```
tool_prompt raised
  ├─ interactive client attached? ──▶ existing path, unchanged
  └─ else, channel with acl.approvals ──▶ send ChannelMessage with
        buttons [Allow, Deny, Always] + correlation_id
        └─ reply within timeout ──▶ resolve onToolPrompt
        └─ no reply ──▶ H2 park (if run is deferrable) else deny
```

- **"Always" does not flip the ACL to `allow`.** It appends a *predicate* to the
  profile's allowlist (H5.2) scoped to the tool and the argument shape that was
  approved. Blanket-allow from a phone button is how an assistant becomes a
  liability.
- Approval messages always include tool name, a bounded input preview, and the
  H6 taint reason when present.
- Race: first responder wins. A prompt answered in the web client marks the
  correlation resolved; the channel adapter is told to disable/annotate the
  stale message.

---

## 8. Capability degradation

Core never asks "is this Telegram?". It asks the capability and degrades:

| Capability false | Core behavior |
|---|---|
| `buttons` | numbered choices appended to text; reply parsed as index |
| `rich` | markdown stripped to plain text before send |
| `files` | file replaced by a path reference line |
| `audio` | audio requests refused at the tool boundary with a clear message |
| `max_chars` set | core chunks on paragraph, then sentence, then hard split |

Chunking lives in core (`src/channels/chunk.ts`) so every adapter inherits
correct behavior instead of reimplementing it badly.

---

## 9. Module layout

```
src/channels/
  types.ts        ChannelAdapter, ChannelMessage, InboundMessage, capabilities
  registry.ts     register / get / list          (mirrors tools/registry.ts)
  loader.ts       .agents/channels discovery     (mirrors tools/loader.ts)
  bindings.ts     binding table + pairing codes
  router.ts       inbound → (user, profile, session) | pending | approval
  approvals.ts    tool_prompt / input_request bridge
  chunk.ts        capability-aware message splitting
  builtin/
    stdout.ts     dev/test sink
    webhook.ts    POST out; inbound route on the shared 7337 server
src/tools/builtin/notify.ts
```

Touched existing files: `src/profiles/schema.ts` (+`channels`),
`src/server/index.ts` (start/stop adapters, wire router),
`src/tools/builtin/index.ts` (conditional `Notify` registration).

---

## 10. Telemetry

New `kind: 'channel'` event: `{ transport, direction: 'in'|'out', ok,
duration_ms, bytes, degraded?: string[], correlation_id? }`.

Answers the questions that actually matter in operation: how many unsolicited
messages did this profile send today, what fraction of approvals were answered
vs timed out, which adapters are flaky.

Identity strings are **hashed** in telemetry. The binding table is the only
place a raw identity is stored.

---

## 11. Security

- **Unbound = inert.** Enforced in `router.ts` before any session or LLM call.
  This is the single most important test in the sprint.
- **Rate limits per channel** (`limits.max_sends_per_hour`) fail closed; the
  overflow is logged and the agent gets an error string, not an exception.
- **Inbound content is untrusted** by definition — an inbound message is
  attacker-authorable if the bot id leaks. It carries `provenance: 'untrusted'`
  into the H6 taint model *unless* it arrives from a paired identity, which is
  the whole point of pairing.
- **No secrets in profile YAML.** Adapter configs reference env var names.
- **Webhook adapter** requires a shared secret and constant-time comparison;
  path is not the auth.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Vendor semantics leak into core | H0.1 CI grep; `config` stays `unknown`; capability degradation table is the only vendor-shaped surface |
| Adapter crash takes down the server | adapters run behind try/catch with restart+backoff; a dead channel degrades `Notify`, never the loop |
| Duplicate delivery on reconnect | `correlation_id` + dedupe window on inbound `(identity, vendor_msg_id)` |
| Session TTL surprises ("it forgot") | TTL configurable; `session_ready` echoed as a subtle marker on first message of a new session |
| Notification spam | out of scope for core by design — but `limits` gives a hard ceiling regardless of agent behavior |

## 13. Open questions

1. Should `Notify` be able to target a *different* user's binding (e.g. an
   assistant messaging a family member)? Deferred — v1 restricts to the run's
   own user; cross-user needs a consent model.
2. Do we need per-channel system-prompt variants (voice wants terse) in core, or
   is that a product-repo concern? Leaning product-repo, revisit at H7.
