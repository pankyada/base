# Architecture Decision Register

> Every load-bearing decision in the harness, with the reason it was made.
> Referenced by `CLAUDE.md`, `AGENTS.md`, and `docs/ROADMAP.md`.

A decision belongs here when reversing it would change more than one module, or
when a future contributor would otherwise "fix" it back to the obvious-but-wrong
alternative. Entries are append-only: superseded decisions stay, marked, with a
pointer to what replaced them.

## Status key

| Symbol | Meaning |
|---|---|
| ✅ | Accepted — implemented and shipped |
| 📋 | Accepted — specced, not yet implemented |
| ⛔ | Superseded — kept for the record |

---

## Index

| ADR | Decision | Status | Area |
|---|---|---|---|
| [90](#adr-90) | Closed-world read-only MCP effects are available before execution | ✅ | MCP / provenance |
| [84](#adr-84) | Interactive session working directory is persisted workspace state | ✅ | sessions |
| [85](#adr-85) | Automatic Town dispatch requires authoritative provider capacity | ✅ | orchestrator |
| [86](#adr-86) | Optional semantic decisions advise context and memory within existing authority | ✅ | decisions |
| [79](#adr-79) | Explicit Codex OAuth transport alongside API-key defaults | 🔄 | providers |
| [80](#adr-80) | Caller scope normalized before Core ownership checks | ✅ | server |
| [81](#adr-81) | Runtime recovery retains state, never executable authority | 🔄 | runtime |
| [82](#adr-82) | Provider effort metadata is evidence-scoped and unknown by default | 🔄 | providers |
| [1](#adr-1) | Profile-driven generic runtime | ✅ | foundations |
| [2](#adr-2) | OpenAI-compatible client against any `base_url` | ✅ | foundations |
| [3](#adr-3) | Four-level discovery, last-write-wins, for all extension points | ✅ | foundations |
| [4](#adr-4) | Memory: two providers, four scopes, `user` private | ✅ | foundations |
| [5](#adr-5) | MCP tools namespaced, schemas passed through verbatim | ✅ | foundations |
| [6](#adr-6) | `deny` is absolute; trust modes may only tighten | ✅ | safety |
| [7](#adr-7) | `mode:` presets override profile ACLs | ✅ | safety |
| [8](#adr-8) | Example profiles use explicit ACLs, not `mode:` | ✅ | profiles |
| [9](#adr-9) | One HTTP+WS server on one port | ✅ | server |
| [10](#adr-10) | Headless REST auto-denies `prompt`-ACL tools | ✅ | safety |
| [11](#adr-11) | State is files under `~/.harness`, per user | ✅ | foundations |
| [12](#adr-12) | WASM-first code execution | ✅ | execution |
| [13](#adr-13) | Multi-agent composition via profiles-as-tools | ✅ | composition |
| [14](#adr-14) | Go/Bubble Tea TUI as the primary dev surface | ✅ | clients |
| [15](#adr-15) | Append-only ledger + per-turn projection | ✅ | context |
| [16](#adr-16) | Destructive condensation | ⛔ | context |
| [17](#adr-17) | Self-calibrating estimator, no tokenizer dependency | ✅ | context |
| [18](#adr-18) | Promotion to memory instead of vector retrieval | ✅ | context |
| [19](#adr-19) | Explicit pins replace the anchor heuristic | ✅ | context |
| [20](#adr-20) | `isAnchor()` markdown heuristic | ⛔ | context |
| [21](#adr-21) | Cache markers behind a flag, default off | ✅ | context |
| [22](#adr-22) | Stage, intensity, and tier are three orthogonal knobs | ✅ | routing |
| [23](#adr-23) | Escalate on observed failure, never size up front | ✅ | routing |
| [24](#adr-24) | Critic must differ in model family from build | ✅ | routing |
| [25](#adr-25) | Stratify, explore, and shadow-run to beat selection bias | ✅ | routing |
| [26](#adr-26) | Artifact-based stage handoff, never transcript-based | ✅ | routing |
| [27](#adr-27) | Recon is a hard gate | ✅ | routing |
| [89](#adr-89) | Execution maps are bounded live observations, not inferred history | ✅ | routing |
| [28](#adr-28) | Harness/product boundary rule, enforced in CI | ✅ | boundary |
| [29](#adr-29) | Channels are transports, not integrations | 📋 | channels |
| [30](#adr-30) | Opaque identity + round-tripped `correlation_id` | 📋 | channels |
| [31](#adr-31) | Pairing required; unbound identity is inert | 📋 | channels |
| [32](#adr-32) | "Always allow" writes a narrow predicate | 📋 | safety |
| [33](#adr-33) | A question is a durable object | 📋 | asks |
| [34](#adr-34) | Expiry resumes with a sentinel, never hangs | 📋 | asks |
| [35](#adr-35) | Unattended approvals reuse the pending mechanism | 📋 | asks |
| [36](#adr-36) | Temporal fields optional; absence means today's semantics | 📋 | memory |
| [37](#adr-37) | Supersession collapses the view, never the history | 📋 | memory |
| [38](#adr-38) | Bounded RRULE subset in-tree | 📋 | memory |
| [39](#adr-39) | Timestamps carry their offset | 📋 | memory |
| [40](#adr-40) | The poll probe never calls the model | 📋 | triggers |
| [41](#adr-41) | Coalesce watch events; suppress self-writes | 📋 | triggers |
| [42](#adr-42) | Overlapping runs skip by default; concurrency cap is global | 📋 | triggers |
| [43](#adr-43) | Budgets fail closed and are checked before every call | ✅ | autonomy |
| [44](#adr-44) | ACL predicates are data, from a closed set | ✅ | autonomy |
| [45](#adr-45) | Audit records *why*, separately from telemetry | ✅ | autonomy |
| [46](#adr-46) | Undo is best-effort and says so | ✅ | autonomy |
| [47](#adr-47) | Network-sourced content is untrusted by default | ✅ | provenance |
| [48](#adr-48) | Taint is stored, monotonic, and human-reset only | ✅ | provenance |
| [49](#adr-49) | The gate sits after everything; `yolo` cannot bypass it | ✅ | provenance |
| [50](#adr-50) | Laundering paths are closed explicitly | ✅ | provenance |
| [51](#adr-51) | The red-team corpus only grows | ✅ | provenance |
| [52](#adr-52) | Gating is off by default in the harness, on in assistant modes | ✅ | provenance |
| [53](#adr-53) | Multi-profile shares a process; crash isolation is not claimed | 📋 | server |
| [54](#adr-54) | MCP connects lazily; the concurrency cap is global | 📋 | server |
| [55](#adr-55) | Voice ships as interfaces only | 📋 | voice |
| [56](#adr-56) | Barge-in cancels the LLM turn and records the interruption | 📋 | voice |
| [57](#adr-57) | The assistant is a separate repo, coupled by submodule | 📋 | product |
| [58](#adr-58) | Telegram only for v1; WhatsApp rejected | 📋 | product |
| [59](#adr-59) | Money integration is read-only, permanently | 📋 | product |
| [60](#adr-60) | One brain, with guarded dev escalation | 📋 | product |
| [61](#adr-61) | Hosting is deferred until after the OSS release | 📋 | product |
| [62](#adr-62) | The assistant is named Mitra | 📋 | product |
| [63](#adr-63) | Product state lives in `~/.mitra/`, separate from `~/.harness/` | 📋 | product |
| [64](#adr-64) | Harness edits never happen from inside the product repo | 📋 | product |
| [66](#adr-66) | Project instruction files are trusted prompt context | ✅ | context |
| [75](#adr-75) | Default profile is a pointer, never a profile-pruning operation | ✅ | onboarding |
| [76](#adr-76) | API keys stay in harness-local env, never a shell rc | ✅ | onboarding |

---

# Foundations

### ADR-1
**Profile-driven generic runtime** — ✅

*Context:* An agent runtime can either encode a product (a coding assistant) or
provide the machinery a product is built from.
*Decision:* The harness is machinery. Model, prompt, tools, ACLs, memory
provider, MCP servers, hooks, triggers, and workflow are all profile YAML. No
vertical behavior is compiled in.
*Consequences:* A new agent type is a YAML file, not a fork. Every feature must
be expressible generically or it does not belong in `src/`. Formalized as
[ADR-28](#adr-28) once a product repo existed to pull against it.

### ADR-2
**OpenAI-compatible client against any `base_url`** — ✅

*Context:* Provider SDKs differ; committing to one vendor's client shape leaks
into every call site.
*Decision:* One OpenAI SDK instance pointed at a per-profile `base_url`, with the
key read from `model.api_key_env`. Anthropic is used through its
OpenAI-compatible endpoint.
*Consequences:* Model swaps are one profile line. The cost: provider-native
features are unavailable through this path — measured and accepted in
[ADR-21](#adr-21).

### ADR-3
**Four-level discovery, last-write-wins, for all extension points** — ✅

*Context:* Skills, custom tools, playbooks — and later channels and voice
providers — all need "where do these live?" answered.
*Decision:* One pattern everywhere: user (`~/.agents/...`), git root, parent dir,
cwd; most specific wins on name collision; dynamic import via `pathToFileURL`;
load failure logs and skips.
*Consequences:* One thing to learn and one place to fix bugs. New extension
points must reuse `src/tools/loader.ts`'s shape rather than invent a second.

### ADR-4
**Memory: two providers, four scopes, `user` private** — ✅

*Context:* Multi-user deployments cross-contaminate when memory has one scope.
*Decision:* `fs` and `graph` providers behind one interface; scopes `session`,
`profile`, `user`, `project`. `user` is private per identity; `profile` is
shared. `MemoryWrite` defaults to `user`.
*Consequences:* Safe defaults for multi-tenant use. Makes the multi-profile split
in [ADR-53](#adr-53) expressible without new machinery.

### ADR-5
**MCP tools namespaced, schemas passed through verbatim** — ✅

*Context:* Two servers can expose the same tool name, and hand-written schema
summaries drift from reality.
*Decision:* Expose as `<server>__<tool>`; pass the server's `listTools` schema
through unmodified so the model sees real parameters.
*Consequences:* No schema maintenance burden, no name collisions. Integrations
stay entirely out of `src/` — the precondition for [ADR-29](#adr-29).

### ADR-6
**`deny` is absolute; trust modes may only tighten** — ✅

*Context:* Convenience modes (`yolo`, `bash`) must not become privilege
escalation.
*Decision:* `resolveAcl` returns `deny` immediately if the profile configured
`deny`, before any mode logic (`src/tools/acl.ts:38`).
*Consequences:* A profile author's `deny` cannot be overridden at runtime by a
client. Extended by [ADR-49](#adr-49), which adds a layer even `yolo` cannot pass.

### ADR-7
**`mode:` presets override profile ACLs** — ✅

*Context:* A `production` profile that silently grants `Bash` through a stray
`tools.builtin` entry is a security failure with no warning.
*Decision:* `applyModeDefaults()` wins on conflict; unlisted tools under
`production` resolve to `prompt`.
*Consequences:* Mode is a real guarantee rather than documentation. The cost is
surprise when both are set — mitigated by [ADR-8](#adr-8).

### ADR-8
**Example profiles use explicit ACLs, not `mode:`** — ✅

*Context:* Because of [ADR-7](#adr-7), an example profile carrying `mode:` cannot
demonstrate fine-grained ACLs — the mode would overwrite them.
*Decision:* Shipped example profiles set explicit ACLs and omit `mode:`.
*Consequences:* Examples teach the ACL surface accurately. Documented in
`docs/superpowers/specs/2026-06-05-profile-examples-design.md`.

### ADR-9
**One HTTP+WS server on one port** — ✅

*Context:* REST (#4), A2A/ACP (#6), webhooks (#5), and the WS protocol each need
an HTTP surface.
*Decision:* A single shared `http.Server` on 7337 hosts all of them.
*Consequences:* One port to deploy, one auth surface. Inbound channels
([ADR-29](#adr-29)) and voice ([ADR-55](#adr-55)) reuse it rather than opening
listeners.

### ADR-10
**Headless REST auto-denies `prompt`-ACL tools** — ✅

*Context:* A `prompt` ACL with no human present has no correct synchronous
answer.
*Decision:* REST/one-shot runs deny rather than block or auto-allow.
*Consequences:* Safe, but it makes unattended runs strictly less capable — the
limitation [ADR-33](#adr-33) and [ADR-35](#adr-35) exist to remove.

### ADR-11
**State is files under `~/.harness`, per user** — ✅

*Context:* A database would be a deployment dependency for a single-operator tool.
*Decision:* Sessions, runs, telemetry, and usage are JSON/JSONL files in
per-user directories, with `sanitizeUserId` on every path segment.
*Consequences:* Backup is `cp -r`; inspection is `cat`; no migrations. Read
patterns are directory scans, which bounds practical scale — accepted, and the
reason [ADR-33](#adr-33) reuses the same layout rather than introducing storage.

### ADR-12
**WASM-first code execution** — ✅

*Context:* Running analyst code server-side means sandboxing, containers, and
server-side attack surface.
*Decision:* Default executor is Pyodide in the user's own browser; the browser
sandbox *is* the isolation. Docker/E2B/Daytona are fallbacks for headless.
*Consequences:* No container spin-up cost and no server-side execution risk for
the common case; requires a capable client, negotiated in `hello`.

### ADR-13
**Multi-agent composition via profiles-as-tools** — ✅

*Context:* Complex agents are compositions of simple ones; a bespoke sub-agent
API would duplicate the profile surface.
*Decision:* Any profile is callable as a tool, with typed input/output contracts
and a depth cap.
*Consequences:* One abstraction for both top-level and nested agents. Budget
inheritance ([ADR-43](#adr-43)) and taint propagation ([ADR-50](#adr-50)) must
therefore cross the delegation boundary.

### ADR-14
**Go/Bubble Tea TUI as the primary dev surface** — ✅

*Context:* The legacy client had grown unmaintainable alongside a second web
client.
*Decision:* Replace it with a Go/Bubble Tea TUI; delete the legacy client rather
than maintain both.
*Consequences:* A fast native terminal surface and cross-platform binaries, at
the cost of a second language in the repo and protocol types mirrored in Go.

---

# Context management

### ADR-15
**Append-only ledger + per-turn projection** — ✅

*Context:* `session.messages` was both the durable record and the wire payload,
so every context operation destructively mutated history.
*Decision:* The ledger is append-only and authoritative; what goes on the wire is
a pure function of (ledger, budget, policy), recomputed each turn.
*Consequences:* Compaction cannot lose data, `/compact` becomes non-destructive,
and tool results can be elided to restorable handles. Supersedes
[ADR-16](#adr-16). Makes stored taint ([ADR-48](#adr-48)) and park/resume
([ADR-33](#adr-33)) safe by construction.

### ADR-16
**Destructive condensation** — ⛔ superseded by [ADR-15](#adr-15)

Summarised messages were spliced into `session.messages`, deleting history,
invalidating the prompt prefix, and offering no termination guarantee when the
summariser threw.

### ADR-17
**Self-calibrating estimator, no tokenizer dependency** — ✅

*Context:* Character-count estimation is biased two ways at once; a tokenizer
package is a heavy dependency and a per-model table to maintain.
*Decision:* Keep the cheap estimate and calibrate it against
`usage.prompt_tokens` the provider already returns, with an EWMA ratio persisted
on the session.
*Consequences:* Converges in ~3 turns per model, costs nothing, adds no
dependency, and corrects automatically for non-Latin content.

### ADR-18
**Promotion to memory instead of vector retrieval** — ✅

*Context:* Retention pressure always eventually wins against the transcript, so
durable facts must not live there.
*Decision:* Extract facts into the `project` memory scope and the knowledge
graph at stage close; no vector store, no embedding retrieval over history.
*Consequences:* Facts survive compaction and are human-readable and editable.
Relevance comes from structure, not ranking — the same stance
[ADR-36](#adr-36) extends with time.

*Addendum (2026-09-19, PT-067/PT-068):* An explicitly enabled decision layer may
rank or select the bounded candidates already returned by structural scope,
link/entity/relation and temporal rules. This narrow exception does not add
embeddings, vector storage or retrieval over the transcript/history. Temporal
validity, imminent material and ADR-19 explicit pins remain authoritative.
See [ADR-86](#adr-86); production calibration is tracked separately in PT-069.

### ADR-19
**Explicit pins replace the anchor heuristic** — ✅

*Context:* Retention was guessed from content shape.
*Decision:* The component that loads material declares its intent —
`Skill` pins its body, workflow artifacts pin for their consuming stages —
bounded by `pin_budget`, with graceful over-budget degradation.
*Consequences:* Retention is intentional and debuggable. Supersedes
[ADR-20](#adr-20).

### ADR-20
**`isAnchor()` markdown heuristic** — ⛔ superseded by [ADR-19](#adr-19)

"Keep tool results ≥400 chars containing a `#`" fired on any markdown-shaped
output and missed anything important that was not markdown.

### ADR-21
**Cache markers behind a flag, default off** — ✅

*Context:* Prompt caching would be the single biggest cost win, and the band
layout was designed to enable it.
*Decision:* Emit breakpoints behind `context.cache`, default `false`. A live
two-call probe against the Anthropic OpenAI-compatible endpoint returned no
cache-read field, so **no caching win is claimed**.
*Consequences:* Honest documentation over an unverified performance claim. A
native provider path would be required before turning this on — a known
consequence of [ADR-2](#adr-2).

---

# Workflow routing

### ADR-22
**Stage, intensity, and tier are three orthogonal knobs** — ✅

*Context:* Most "router" designs conflate what work is being done, how much of
it, and which model — which makes the resulting telemetry uninterpretable.
*Decision:* Stage from the playbook, intensity from cheap LLM triage, tier from
the routing policy. Profiles bind role→model; playbooks bind stage→role.
*Consequences:* A model swap is one profile line and historical telemetry stays
comparable, because events record both tier and concrete model id.

### ADR-23
**Escalate on observed failure, never size up front** — ✅

*Context:* Predicting the needed model before doing the work is guessing.
*Decision:* Start at the playbook floor and promote on evidence (unmet contract,
repeated verify failure, edit thrash, tool error rate, low self-confidence, a
high-severity review finding). Demote only after repeated first-try success, never
below the floor and never when the work is irreversible.
*Consequences:* Costs track observed difficulty and fall over time; the price is
occasional rework at a cheap tier.

### ADR-24
**Critic must differ in model family from build** — ✅

*Context:* Self-review misses correlated blind spots, not capability.
*Decision:* The `critic` role should resolve to a different family than `build`;
profile load warns when they share a provider.
*Consequences:* Review catches a genuinely different error class, at the cost of
a second provider key for full benefit.

### ADR-25
**Stratify, explore, and shadow-run to beat selection bias** — ✅

*Context:* Cheap tiers get the easy tasks, so naive analysis "proves" frontier
models are never needed.
*Decision:* All metrics stratified by task class × blast radius (the CLI refuses
unstratified tier comparisons); ~12% forced exploration up and down; sampled
paired shadow runs blind-judged for short high-leverage stages. Headline metric
is **cost per accepted task**, not cost per token or pass rate.
*Consequences:* The dataset can contradict the current policy instead of only
confirming it, at a small deliberate cost premium.

### ADR-26
**Artifact-based stage handoff, never transcript-based** — ✅

*Context:* Passing whole transcripts between stages loses information under
compaction and blows budgets.
*Decision:* Each stage produces a contract-validated artifact; the next stage
consumes the artifact.
*Consequences:* Stages are independently re-runnable and debuggable; contracts
give escalation ([ADR-23](#adr-23)) a concrete failure signal.

### ADR-27
**Recon is a hard gate** — ✅

*Context:* Planning before understanding the existing solution is the most
expensive failure mode in agent work.
*Decision:* `min_intensity: { recon: 1 }` — plan/design may not run until recon
has actually happened.
*Consequences:* A small fixed tax on trivial tasks, accepted deliberately. A
constraint set by the repo owner, not derived from the code.

---

# Boundary

### ADR-28
**Harness/product boundary rule, enforced in CI** — ✅

*Context:* Building a personal-assistant product on the harness creates constant
pressure to add "just one" vendor or life-domain feature to `src/`.
*Decision:* A harness change is allowed only if its description never needs the
words *assistant*, *Gmail*, *Telegram*, *WhatsApp*, or *voice*. A CI scan over
`src/` enforces it, ignores comments, and uses a reviewed path-and-term
allowlist for justified pre-existing generic identifiers. This shipped
**before** any other work in the #17–#23 track.
*Consequences:* Makes [ADR-1](#adr-1) mechanically checkable. Some product
features become harder to build — which is the intended pressure, pushing them
into adapters, profiles, and skills.

---

# Channels & asks

### ADR-29
**Channels are transports, not integrations** — 📋

*Context:* Unattended runs cannot reach a human; the naive fix is a Telegram
integration in core.
*Decision:* Core defines `ChannelAdapter`, a registry, a loader, routing, and two
vendor-free adapters (`stdout`, `webhook`). Vendor adapters live in
`.agents/channels/`. Adapter `config` stays `Record<string, unknown>` — core
never gains a typed view of a vendor's settings.
*Consequences:* Any messaging surface is addable without touching `src/`. Core
degrades by capability flags rather than by vendor checks.

### ADR-30
**Opaque identity + round-tripped `correlation_id`** — 📋

*Context:* Vendor threading models differ wildly, and parsing identities leaks
vendor shape into core.
*Decision:* `identity` is an opaque string core stores and compares but never
parses. Replies are matched by an opaque `correlation_id` the adapter echoes back.
*Consequences:* One mechanism works across buttons, replies, and a numbered text
menu. Threading niceties are the adapter's problem.

### ADR-31
**Pairing required; unbound identity is inert** — 📋

*Context:* A bot id leaks, and an internet-reachable agent becomes anyone's agent.
*Decision:* Default `inbound: paired`. An unbound identity gets at most one
reply — a request for a single-use, expiring pairing code — and can never start
a session, spend tokens, or reach a tool. Enforced in the router before any
session creation.
*Consequences:* The single most important test in the channels sprint. Slightly
more onboarding friction, in exchange for the bot not being an open endpoint.

### ADR-32
**"Always allow" writes a narrow predicate** — 📋

*Context:* An approval UI with an "always" button is how an assistant quietly
becomes a liability.
*Decision:* "Always" appends an [ADR-44](#adr-44) predicate scoped to the tool
and the argument shape that was approved — never `allow` on the tool.
*Consequences:* Convenience without blanket escalation. Approvals accumulate as
readable, auditable rules.

### ADR-33
**A question is a durable object** — 📋

*Context:* `AskUser` awaits an in-memory promise, so an unattended run cannot
ask, a question holds a socket for its whole life, and a restart destroys it.
Human latency and machine latency differ by four orders of magnitude.
*Decision:* Park the question to disk, notify over a channel, unwind the loop via
a `ParkSignal`, and resume on answer — same run id, ledger appended as though
the answer had been instant.
*Consequences:* The model never sees a discontinuity. Runs survive restarts.
Requires tools holding external resources to release them before parking.

### ADR-34
**Expiry resumes with a sentinel, never hangs** — 📋

*Context:* An unanswered question could hang a run forever or silently abandon
paid-for work.
*Decision:* TTL expiry resumes the run with an explicit
`[no answer within <ttl>]` tool result and lets the agent decide.
*Consequences:* No zombie runs; the convention for what to do next is a profile
prompt concern, not core policy.

### ADR-35
**Unattended approvals reuse the pending mechanism** — 📋

*Context:* Approvals and deferred asks are the same shape — a question with a
correlation id — reached through different entry points.
*Decision:* An unattended `tool_prompt` becomes a pending record with
`kind: 'select'` and a short TTL, using the same store, resume path, and
idempotence.
*Consequences:* One mechanism to test and operate. Removes the
[ADR-10](#adr-10) limitation for channel-equipped profiles.

---

# Temporal memory

### ADR-36
**Temporal fields optional; absence means today's semantics** — 📋

*Context:* Every memory fact is currently implicitly eternal and implicitly
current, which produces confidently stale answers — worse than no memory,
because the agent acts on them.
*Decision:* Add optional `valid_from` / `valid_until` / `recur` / `entity` /
`confidence`. Absence maps exactly to current behavior, so existing files load
unchanged, forever.
*Consequences:* Back-compat is guaranteed by construction rather than by
migration. An old-format fixture directory guards it in CI.

### ADR-37
**Supersession collapses the view, never the history** — 📋

*Context:* Overwriting a changed fact destroys the record of what was true before.
*Decision:* Within an entity, the latest valid fact wins in query results;
older ones stay on disk and remain retrievable via `Recall({ at: <past> })`.
*Consequences:* Trustworthy current answers plus an auditable history. Storage
grows; accepted, consistent with [ADR-11](#adr-11) and [ADR-15](#adr-15).

### ADR-38
**Bounded RRULE subset in-tree** — 📋

*Context:* Full RFC 5545 is large; the useful part for an assistant is small.
*Decision:* Implement `FREQ`/`INTERVAL`/`BYDAY`/`BYMONTHDAY`/`UNTIL`/`COUNT`
with windowed, capped expansion and no dependency. Unbounded expansion is not
exposed at all.
*Consequences:* Fixed scope — anything beyond the subset is a rejected feature,
not a backlog item. Month-end, DST, and leap-day behavior are specified and
table-tested rather than inherited.

### ADR-39
**Timestamps carry their offset** — 📋

*Context:* "9am standup" means 9am somewhere; normalizing to bare UTC breaks for
anyone who travels.
*Decision:* Store ISO-8601 with offset. An optional IANA `timezone` preserves
wall-clock recurrence across DST; an offset-only recurrence is deliberately
fixed-offset rather than guessing a zone.
*Consequences:* Correct across DST and travel when a zone is supplied, without
inventing a timezone from an ambiguous offset. Naive timestamps remain invalid.

---

# Triggers & autonomy

### ADR-40
**The poll probe never calls the model** — 📋

*Context:* "Check every 5 minutes" costs a full LLM turn per tick — ~288 turns a
day per source, almost all discovering nothing.
*Decision:* A poll trigger runs one tool call, extracts a scalar cursor, and
fires only when it advances. Cold start records the cursor without firing; probe
errors back off exponentially rather than firing.
*Consequences:* The dominant cost of an always-on agent effectively disappears.
CI asserts zero token spend on an unchanged-cursor tick.

### ADR-41
**Coalesce watch events; suppress self-writes** — 📋

*Context:* Naive file watching is a spend disaster, and an agent writing into a
path it watches re-triggers itself forever.
*Decision:* Debounce plus a batch cap plus ignore defaults; and a write-
suppression window sourced from the audit journal so harness-authored writes do
not wake the harness.
*Consequences:* A `git checkout` produces one run, not hundreds. Creates a real
dependency from triggers on [ADR-45](#adr-45).

### ADR-42
**Overlapping runs skip by default; concurrency cap is global** — 📋

*Context:* A slow brief overlapping its next tick double-spends; and six profiles
each capped at three runs is eighteen concurrent runs on a laptop.
*Decision:* Default overlap policy `skip`, queue depth capped at one (newest
supersedes), and `max_concurrent_runs` enforced globally rather than per profile.
*Consequences:* Conservative under load. A backlog of stale wake-ups is
discarded, which is correct — a stale signal has no value.

### ADR-43
**Budgets fail closed and are checked before every call** — ✅

*Context:* Checking spend after the fact is a receipt, not a budget.
*Decision:* Cost, tool-count, and wall-clock limits enforced before each model
call and each tool call; malformed budget means zero, not infinity; delegated
children inherit a share of the parent's remainder, never a fresh allowance.
*Consequences:* Fan-out ([ADR-13](#adr-13)) cannot multiply spend. A wedged MCP
server is caught by wall time even when cost stays flat.

### ADR-44
**ACL predicates are data, from a closed set** — ✅

*Context:* `allow`/`prompt`/`deny` per tool name cannot express "allow when the
arguments look like this" — forcing a choice between over-permission and
constant interruption.
*Decision:* Object ACLs with `allow_if`/`deny_if` over a closed vocabulary
(`equals`, `in_list`, `matches` as glob, `under_path` via realpath, `lt`/`gt`,
`absent`/`present`). AND-only, deny-wins, unknown predicate fails the profile
load. **No code evaluation of any kind.**
*Consequences:* Rules stay auditable by reading them. Anything needing OR is two
rules. A config file that can execute is an attack surface — that is the whole
reason for the restriction.

### ADR-45
**Audit records *why*, separately from telemetry** — ✅

*Context:* Telemetry is sampled, aggregate, and disposable. "Why did my assistant
send that?" needs complete, per-action, permanent data.
*Decision:* An append-only audit journal for every effectful call, carrying
`decided_by` and `decided_reason`, the taint flag, and an optional undo
descriptor.
*Consequences:* Every autonomous action is attributable to the rule that
permitted it. Also supplies the write record [ADR-41](#adr-41) depends on.

### ADR-46
**Undo is best-effort and says so** — ✅

*Context:* A universal undo is not implementable across third-party services.
*Decision:* Core ships inverses for its own tools; other tools may supply an undo
descriptor with an expiry. Entries without one are listed as **not undoable**
rather than silently skipped.
*Consequences:* Honest capability. Real-world reversal windows are modeled
explicitly instead of assumed.

---

# Provenance

### ADR-47
**Network-sourced content is untrusted by default** — ✅

*Context:* An agent reading email holds instructions from strangers that are
token-indistinguishable from the user's.
*Decision:* Tool results carry provenance; MCP, web, shell output, and unpaired
inbound default to **untrusted**. A tool author who forgets gets the safe answer.
*Consequences:* Some legitimate sources are marked untrusted and need an explicit
per-tool opt-in. Wildcard trust overrides are not offered.

### ADR-48
**Taint is stored, monotonic, and human-reset only** — ✅

*Context:* Deriving taint from current context would silently un-taint it through
elision, digest, or park/resume.
*Decision:* Store taint on the ledger entry. It is monotonic within a turn — a
trusted read afterwards cannot clean it — and resets only on a genuine human
message. A trigger firing is not a human.
*Consequences:* "Read the attack, then read a trusted file" does not work.
Requires [ADR-15](#adr-15)'s append-only ledger to be sound.

### ADR-49
**The gate sits after everything; `yolo` cannot bypass it** — ✅

*Context:* Prompt-level injection defenses are probabilistic; they lower the rate
without closing the path.
*Decision:* In a tainted turn, `outbound` and `destructive` tools escalate to
human approval regardless of ACL, predicates, or approval mode — with the
tainting source quoted in the prompt. This is the one place `yolo` is not
absolute, because trust mode expresses the human's posture toward *their own
agent*, not toward a stranger's email.
*Consequences:* The claim is narrow and structural: content the agent read can
never *silently* authorize an action. The model may still be fooled; the gate
holds anyway. It does not protect a user who approves a malicious request.

### ADR-50
**Laundering paths are closed explicitly** — ✅

*Context:* A gate on direct action is worthless if the agent can route around it.
*Decision:* Close all three known paths — memory (writes record the writing
turn's taint), delegation (a tainted parent cannot spawn an untainted child), and
files (reads of paths written during a tainted turn taint the reader).
*Consequences:* Taint crosses turn, agent, and storage boundaries. Each closure
is a permanent CI fixture.

### ADR-51
**The red-team corpus only grows** — ✅

*Context:* Injection defenses rot silently; a refactor can reopen a closed path
with every unit test still green.
*Decision:* A permanent fixture corpus that grows and never shrinks, run on every
change to tools, loop, context, or channels. Assertions are on *system* behavior
("no effectful tool ran without an approval naming the source"), never on the
model's refusal.
*Consequences:* Defenses are regression-tested rather than assumed.

### ADR-52
**Gating is off by default in the harness, on in assistant modes** — ✅

*Context:* A developer profile reading its own repo and running its own shell
does not need this, and defaulting it on would break existing profiles.
*Decision:* `safety.gate_untrusted_actions` defaults `false`; `mode: assistant`
and `mode: production` default it `true`; startup warns when a profile has
channels + MCP + outbound tools with the gate off.
*Consequences:* Consistent with [ADR-7](#adr-7) — mode carries the security
posture. The warning covers the exact misconfiguration this exists to prevent.

---

# Server & voice

### ADR-53
**Multi-profile shares a process; crash isolation is not claimed** — 📋

*Context:* One profile per process means N ports, N supervisors, N MCP
subprocess sets, and no shared session view.
*Decision:* One process serves a profile directory. Server, telemetry, channels,
and `user`-scope memory are shared; sessions, `profile` memory, MCP sets, tool
views, and budgets are isolated. **Crash isolation is explicitly not claimed** —
operators who need it run separate processes, and the docs say so.
*Consequences:* One deployment unit. An honest limitation stated rather than an
implied guarantee that does not hold.

### ADR-54
**MCP connects lazily; the concurrency cap is global** — 📋

*Context:* Six profiles × four stdio MCP servers is 24 subprocesses before a
single message arrives.
*Decision:* Connect on first use per profile, close after idle timeout,
reconnect on demand; enforce run concurrency globally.
*Consequences:* Boot is cheap and a laptop-class box stays viable, at the cost of
first-use latency on a cold MCP server.

### ADR-55
**Voice ships as interfaces only** — 📋

*Context:* Voice is a v1 product requirement, and the obvious implementation puts
an STT/TTS vendor in core.
*Decision:* Core defines streaming `SpeechToText` / `TextToSpeech` interfaces,
audio WS frames, endpointing, and sentence-level chunking. Providers load from
`.agents/voice/`. Core gains no audio dependency, asserted in CI.
*Consequences:* Cloud and local providers are swappable per profile. Both
interfaces are streaming-only — a batch interface would foreclose acceptable
latency permanently.

### ADR-56
**Barge-in cancels the LLM turn and records the interruption** — 📋

*Context:* Stopping playback alone leaves the model generating and billing for an
abandoned answer; discarding the partial makes the next turn's context claim
something was said that never was.
*Decision:* Interruption aborts synthesis, playback, and the in-flight LLM turn,
and appends the partial assistant message **marked interrupted**.
*Consequences:* Honest context and no wasted generation. Natural under
[ADR-15](#adr-15) — a normal append with a flag, not a rewrite.

---

# Product (assistant repo)

### ADR-57
**The assistant is a separate repo, coupled by submodule** — 📋

*Context:* Building the product inside the harness would erode [ADR-1](#adr-1)
within weeks.
*Decision:* A separate repo consumes the harness as a git submodule pinned by
commit, inside a pnpm workspace. Not an npm publish — co-development matters
more than a clean registry boundary at this stage.
*Consequences:* No release ceremony while both move fast; some friction for
outside contributors, wrapped in a `pnpm setup` script.

### ADR-58
**Telegram only for v1; WhatsApp rejected** — 📋

*Context:* WhatsApp is the higher-value channel personally, but both routes are
bad: unofficial clients risk a number ban, and the official Cloud API's 24-hour
window plus template approval fits a *proactive* assistant badly.
*Decision:* Telegram only through the OSS release. WhatsApp revisited later, and
only via the official Cloud API. No unofficial client ships in a public repo.
*Consequences:* Loses the preferred channel in v1; avoids shipping ban risk to
strangers. Cheap to revisit — it is one adapter under [ADR-29](#adr-29).

### ADR-59
**Money integration is read-only, permanently** — 📋

*Context:* Financial capability is the highest-consequence, least-reversible
thing an assistant could hold.
*Decision:* Balance tracking, categorization, and bill reminders derived from
notification emails. No transactional capability — not a config toggle, not
present in the tool list, asserted by test.
*Consequences:* Most of the value with none of the catastrophic downside. A
deliberate permanent ceiling, not a phase-one limitation.

### ADR-60
**One brain, with guarded dev escalation** — 📋

*Context:* "Fix that bug" from a phone is genuinely valuable, but the assistant
reads attacker-authored email — so a path from that content to `Bash` is remote
code execution against the operator's own machine.
*Decision:* The assistant profile is provably shell-free (asserted on the parsed
profile). Coding work delegates to a dev sub-agent behind four independent
preconditions: untainted turn, human-triggered (never cron/watch/poll), explicit
per-task approval, and a repo allowlist. The sub-agent runs in a throwaway
worktree with no push and no credentials.
*Consequences:* The highest-risk decision in the product plan, accepted with
mitigations. Every precondition gets its own failing-case test, plus a permanent
fixture asserting email→dev is impossible.

### ADR-61
**Hosting is deferred until after the OSS release** — 📋

*Context:* Multi-tenant hosting of other people's mail and money is a different
threat model and a different set of obligations.
*Decision:* Ship the self-hosted product and use it for a month first. Per-tenant
isolation, OAuth verification, quotas, and compliance come after.
*Consequences:* Slower path to a hosted offering; avoids building for tenants
before the single-user product is proven.

### ADR-62
**The assistant is named Mitra** — 📋

*Context:* The product needed a name for the repo, the CLI binary, the config
file, and the state directory — all of which are expensive to change later.
*Decision:* **Mitra** — Sanskrit for *friend*, and the Vedic deity of contracts,
oaths, and kept agreements. Tagline: *an assistant that keeps its agreements.*
Chosen over `sahay` (warmer but more generic) and `keel` (neutral but cold);
`smriti` was rejected outright for colliding with an active AI-agent memory
package.
*Consequences:* The name is a checkable promise, so three things must stay
visible product surfaces rather than settings pages: the audit trail
([ADR-45](#adr-45)), the limits ([ADR-43](#adr-43), [ADR-44](#adr-44)), and
explained refusals ([ADR-49](#adr-49)). A feature that makes those harder to see
is off-brand regardless of utility. The npm name is held by an abandoned 2022
package, which is irrelevant under [ADR-57](#adr-57).

### ADR-63
**Product state lives in `~/.mitra/`, separate from `~/.harness/`** — 📋

*Context:* The product and the harness both persist state, and a single
directory would entangle their lifecycles.
*Decision:* Harness state (sessions, runs, telemetry, usage) stays in
`~/.harness/` per [ADR-11](#adr-11). Product state (secrets, channel bindings,
cursors, product config) lives in `~/.mitra/`.
*Consequences:* A harness upgrade never threatens product state, and resetting
the product never destroys session history. Two directories to back up.

### ADR-64
**Harness edits never happen from inside the product repo** — 📋

*Context:* A git submodule is a full checkout, so `vendor/base` is editable from
the product repo — which is precisely how the [ADR-28](#adr-28) boundary erodes,
one convenient fix at a time.
*Decision:* Harness changes are made in the `base` repo, committed and pushed
there, then pinned. A pre-commit hook in the product repo rejects any staged
change under `vendor/`, and CI re-checks it.
*Consequences:* Co-developing a harness change with a product feature takes an
extra commit-push-pin cycle. Accepted: the friction is the point, and it is the
mirror of the guard `base` runs in the other direction.

### ADR-65
**Channels keep transport semantics outside core** — ✅

*Context:* Unattended runs need outbound delivery and inbound human responses,
but embedding any transport's identity format, auth, or message semantics in
the harness would break the product boundary.
*Decision:* Core owns only opaque identities, bindings, routing, approvals,
capabilities, chunking, and rate limits. Adapters own transport config and
delivery. Core ships only `stdout` and `webhook`; all other adapters load from
`.agents/channels/`. Unbound paired identities never create sessions or invoke
the model, and webhook ingress requires a constant-time shared-secret check.
*Consequences:* New transports need no core change, but adapters must expose
their own validation and retry behavior. Approval delivery degrades closed
when no bound recipient or approved channel exists.

### ADR-66
**Project instruction files are trusted prompt context** — ✅

*Context:* Agents need the repository's `AGENTS.md` and `CLAUDE.md` conventions
to behave consistently across interactive, delegated, and REST runs.
*Decision:* Discover those files using the established four-level,
last-write-wins ladder and inject them with per-file provenance headers at the
same trust level as the profile's `system_prompt`.
*Accepted risk:* A hostile repository can grant its `AGENTS.md` system-prompt
authority. Operators can disable discovery with `context.project_files: false`,
and the provenance header keeps the source of every instruction visible in the
assembled prompt.
*Consequences:* Normal operator repositories need no prompt duplication, while
untrusted checkouts have an explicit kill switch and visible instruction source.

### ADR-67
**Stage ACL overlays are evaluated before approval-mode defaults** — ✅

*Context:* Workflow stages share the profile-wide ACL, but recon, plan, and
design are rehearsal stages and must not mutate the workspace. Approval modes
such as `yolo` otherwise widen missing or prompt ACLs.
*Decision:* The workflow supplies a read-only overlay for those stages. The ACL
resolver applies an overlay deny after preserving an explicit profile deny and
before mode defaults. The overlay cannot grant access, so `yolo` cannot widen a
plan stage; build, verify, and review remain profile-governed.
*Consequences:* Stage safety is enforced centrally for interactive, delegated,
and workflow runs. Profiles without a stage remain behaviorally unchanged, and
the overlay adds no profile schema or dependency surface.

### ADR-68
**Canvas pins persist in browser storage, not the harness state directory** — ✅

*Context:* Canvas layout is a browser presentation concern, while artifact
payloads remain session-owned and can be rehydrated from the read APIs.
*Decision:* Store pin order, panel sizes, and the last-good payload reference in
`localStorage` keyed by session and artifact id. Never write canvas state through
REST; refresh remains an explicit client action.
*Consequences:* Reload preserves the analyst layout without adding a server
write endpoint. Clearing browser storage drops pins but does not delete source
artifacts or session history.

### ADR-69
**Browser transport uses an exact origin allowlist with an explicit browserless branch** — ✅

*Context:* WebSocket upgrades do not receive browser same-origin protection, so any
local page could otherwise connect to the harness; TUI and CLI clients do not send an
`Origin` header.
*Decision:* Validate `Origin` before WebSocket upgrade acceptance and before REST route
matching. `HARNESS_ALLOWED_ORIGINS` is an exact-match comma-separated allowlist with
localhost defaults; missing `Origin` is accepted only through the explicit
browserless policy branch, and `*` is an operator-visible escape hatch.
*Consequences:* Browser exposure is bounded by configuration without breaking
browserless clients. Origin rejections are counted for `/health` and logged as
security events.

### ADR-70
**Approval mode is server-authoritative and bounded by profile trust** — ✅

*Context:* A browser-controlled `hello.yolo` flag must not widen a profile's ACL, and
the existing mode defaults did not cover every non-developer profile.
*Decision:* Resolve the effective approval ceiling as the strictest of selected
profile, `HARNESS_APPROVAL_MODE`, and a trust ceiling. `developer` and mode-less
profiles may reach `yolo`; `analyst`, `assistant`, and `production` cap at `danger`.
Client requests can only move to a stricter mode, and `hello.yolo` is ignored.
*Consequences:* Browser clients cannot grant themselves bypass authority. Existing
non-developer profiles stay bounded even when deployment configuration requests
`yolo`; the behavior is documented as a breaking approval change.

### ADR-71
**Generated surfaces run in an opaque-origin sandbox** — ✅

*Context:* Model-authored HTML and JavaScript execute in the operator's browser,
so a normal same-origin iframe would expose parent DOM, cookies, storage, and
localhost services.
*Decision:* SurfaceHost uses an iframe with sandbox="allow-scripts" and no
allow-same-origin. The document CSP is default-src none with connect-src none;
only the small allowlisted postMessage bridge is accepted.
*Consequences:* Surfaces can render and emit structured UI results, but cannot
reach the host page or network. The permanent browser corpus guards the boundary.

### ADR-72
**Fixed widget kit and generative surfaces are separate rendering paths** — ✅

*Context:* Fixed artifacts need stable theming, CSV export, and canvas pinning;
bespoke generated UI needs an escape hatch when no widget kind fits.
*Decision:* Route known ArtifactWidget kinds through the fixed hand-rolled kit.
Route bespoke SurfaceSpec payloads through SurfaceHost. Do not make surfaces the
default widget renderer or grant them fixed-kit guarantees.
*Consequences:* The two paths can evolve independently and their security and
export contracts remain explicit.

### ADR-73
**Use-case films are narrative, the architecture explorer stays the map** — ✅

*Context:* `docs/architecture-site/` already animates one generic 11-step
request lifecycle across every layer, module, and file — it answers "what
exists and where." The four documented use cases (`docs-site/use-cases.md`)
had no animation at all, and the obvious failure mode was bolting four more
lifecycle buttons onto the explorer, which would blur a spatial map with
scenario-specific narrative it was never designed to carry.
*Decision:* Build a second, deliberately separate animation surface —
`docs-site/how-it-works.md` — with one short scripted film per use case,
each citing the real source paths it depicts. The explorer keeps exactly one
generic lifecycle and does not grow per-use-case branches; the films do not
attempt to be a component map and carry no node/edge/file browser.
*Consequences:* Two animation surfaces exist on purpose, cross-linked in both
directions (`architecture.md` ↔ `how-it-works.md`) so neither reads as
redundant with the other. A future contributor tempted to "unify" them should
read this entry first — the split is the design, not an oversight.

### ADR-74
**Use-case films are declarative data rendered by SVG+DOM, not canvas** — ✅

*Context:* The architecture explorer renders on a Konva canvas. Reusing that
approach for the films would mean canvas-painted captions — not selectable,
not searchable by VitePress's local search, not readable by a screen reader —
and would couple four scenario scripts to one rendering engine.
*Decision:* One file (`docs-site/.vitepress/theme/films.ts`) holds both the
architecture model — nodes, subsystem groups, zones, and a deterministic
layout function — and the four `Film`/`Beat[]` scripts that move through it.
Node ids are the SAME ids the explorer uses, so the two surfaces share one
vocabulary. The stage renders as inline SVG (server container, subsystem
bands, node rects, edge paths) with captions as real DOM text beside it,
animated with `motion`'s vanilla DOM API plus a packet driven along
`getPointAtLength`. `tests/use-case-films.test.ts` asserts every cited path
exists AND that the computed layout keeps every server node inside the server
box with no intra-band overlap — geometry regressions fail CI, not review.
Under `prefers-reduced-motion` the same data renders as a static numbered
list, so there is no second content source to maintain.
*Consequences:* Captions stay real, accessible text; layout is testable
because it is computed rather than hand-placed; and the scene model stays
renderer-agnostic, so a future Remotion pass for shareable video is additive
rather than a rewrite. This is a deliberate divergence from the sibling Konva
app, which owns the full 40-node map and its own generic lifecycle.

### ADR-75
**Default profile is a pointer, never a profile-pruning operation** — ✅

*Context:* The harness already loads a directory of profiles and supports
mid-session switching. A fresh install previously reached only `coding.yaml`,
which made the other shipped profiles unreachable and invited a second,
destructive profile-selection mechanism.
*Decision:* Store `default_profile` as a profile **name** in machine-level
`~/.harness/config.json`. Server startup loads the configured profiles
directory, then passes that name to the existing registry selection path. All
profiles remain installed and switchable. Presentation preferences remain in
client-owned `tui.json`, not this machine-level config.
*Consequences:* Changing the default is reversible and does not alter any
profile. Custom profiles continue to participate in the same registry. A
missing or invalid config degrades to the registry's existing `coding`, then
alphabetical, fallback rather than preventing startup.

### ADR-76
**API keys stay in harness-local env, never a shell rc** — ✅

*Context:* First-run onboarding needs a durable API-key path, but appending an
export to a shell rc leaks the key to unrelated processes, has inconsistent
permissions, and does not translate to Windows.
*Decision:* Store `KEY=value` lines in `~/.harness/env`, created with mode
`0600`, and load them only when the harness starts. Values already present in
the ambient process environment always win. The loader is a single seam for a
future OS-keychain backend.
*Consequences:* The file is plaintext at rest, comparable to
`~/.aws/credentials`; this is documented rather than treated as secret storage.
Users get a portable, contained setup path now, while keychain support can be
added without changing profile or server code later.

### ADR-77
**Onboarding lives in one process** — ✅

*Context:* The Node CLI now owns use-case selection, provider/model defaults,
secret handling, profile diffing, config persistence, and doctor checks. A
second native Go wizard would immediately duplicate that policy surface and
drift as profiles and providers change.
*Decision:* The Go TUI delegates first-run setup and reconfiguration to
`harness init` with the terminal inherited, then re-reads `config.json` to
join the selected profile. Go retains only the small process handoff and
legacy backup helper; it does not write profiles or prompts.
*Consequences:* Every surface gets the same onboarding behavior and security
guarantees. Contributors adding onboarding policy must change the Node wizard
and its tests, not re-add a native Go flow.

### ADR-78
**Verifiable work uses additive file records and deterministic validators** — 📋

*Context:* Missions, replay journals, evaluations, rehearsals, conflicts,
correction proposals, artifact recipes, and challenge rounds need inspectable
state without introducing a database or a second execution engine.
*Decision:* Persist versioned records below the existing per-user harness paths
with same-directory temp + rename writes, monotonic revisions, bounded previews,
content hashes, and explicit unknown/stale/unresolved states. Deterministic
validators may verify evidence; model prose and model judges remain advisory.
Playback and branches never fall back to live effects, and promotion/apply steps
reuse explicit operator gates.
*Consequences:* Records remain readable and recoverable with the existing file
workflow. Multi-process transactions, exactly-once external effects, and seeded
model determinism remain deliberately unclaimed.

### ADR-79

**Explicit provider transport with separate Codex credentials** — 🔄

*Context:* Personal Codex subscription access requires OAuth and a Responses
backend. ADR-2's configurable OpenAI-compatible API client remains the default;
replacing its API key with an OAuth token would not supply the required protocol.

*Decision:* Select `model.auth: codex_oauth` explicitly. Keep API-key profiles,
ambient environment precedence and existing profile selection intact. Base owns
OAuth state under its private auth directory and keeps ownership of tool
execution, approvals and safety. Use a normalized provider seam with a direct
Responses adapter. Provider-only continuation must remain account-bound and
excluded from ordinary exports, prompts and UI readers. No automatic fallback
changes billing mode. No Claude subscription support is included.

*Consequences:* ADR-43 budgets continue to constrain estimated work. Subscription
token costs are API-equivalent estimates with unknown actual billed cost, not
zero-cost work. Shared attempt limits and deadlines must include helpers and
children. Mock tests establish local contracts; live client registration,
entitlement, continuation and billing acceptance remain separate gates.

*Implementation checkpoint (2026-09-06):* Local experimental code and automated validation complete; live acceptance pending. See [acceptance evidence](superpowers/reports/codex-implementation-acceptance.md).

### ADR-80

**Caller scope is normalized before Core ownership checks** — ✅

*Context:* Core REST and WebSocket routes accept caller-asserted user and
session identifiers. Sanitizing malformed values first can turn invalid input
into another valid scope, while ID routes that look up globally can disclose or
mutate another user's run or pending question.

*Decision:* Normalize explicit user scope through one bounded helper before any
store lookup. Reject non-string or oversized values with a bounded diagnostic;
when query and body scope are both supplied they must agree. ID reads and
mutations enforce ownership and return not-found on mismatch. Omitted scope
keeps documented local defaults and aggregate list behavior. Until connection
state can be fully rebound, cross-session control attach fails closed.

*Consequences:* Scope remains caller-asserted local identity, not authentication
or multi-tenant authorization. Existing clients must adopt explicit scope for
isolated ID operations; no persisted key format changes.

### ADR-81

**Runtime recovery retains state, never executable authority** — 🔄

*Context:* Event tails can overflow and process restarts cannot safely restore
in-memory callbacks or controller leases. Child agent telemetry also shares the
root wire stream.

*Decision:* Persist bounded detached runtime projections alongside event tails;
future/stale cursors return snapshot resync, restart clears ephemeral actions
and controller authority, and child stats/terminal frames cannot replace root
run recovery state. Opt-in attach/subscription requests may carry bounded
`request_id` correlation. Durable pending answers acknowledge only after
validation and atomic state transition; invalid or stale callbacks return a
negative error.

*Consequences:* Recovery reports honest interruption and bounded incompleteness;
it makes no exactly-once external-effect promise and does not implement
cross-session execution handoff.

### ADR-82

**Provider effort metadata is evidence-scoped and unknown by default** — 🔄

*Context:* Provider model discovery exposes model identity separately from
reasoning metadata. Prefix-based effort inference can present unsupported
options as live capability, while API-key and subscription transports have
different payload contracts.

*Decision:* Parse provider-native supported/default effort fields only when
returned by discovery, bound and deduplicate values, and attach transport,
endpoint and opaque account scope. Unknown model IDs remain usable with the
provider default; explicit effort requires supported metadata. Codex serializes
validated effort and omits Default. The current OpenAI-compatible API-key
adapter keeps effort unknown until its exact payload contract is verified.
Profile aliases validate bounded syntax offline; capability validation remains
an execution/selection concern. Ultra stays disabled pending adapter evidence.

*Consequences:* Catalog metadata cannot claim entitlement, inference quality or
billing support. Client protocol fields remain additive and generated only;
picker/client adoption and live provider acceptance remain PT-016/PT-014.

### ADR-83

**Live approvals survive reconnect only while their server process remains alive** — 🔄

*Context:* Approval callbacks were connection-local. Closing a browser or TUI
socket aborted the turn and resolved every prompt false, even though the
server-owned runtime still identified an actionable approval. A reconnecting
client had neither the authority callback nor, after event-tail overflow, the
prompt body required to render a safe control.

*Decision:* Keep a bounded, scoped in-process approval registry and a bounded
full-payload actionable projection in the session runtime. A reconnect must
resume the same user-owned session and claim a fresh controller lease before
resolving a live approval. The registry expires callbacks closed; explicit
cancel resolves them false; snapshots never create a control from an ID alone.
Controller leases claimed by a live socket do not expire due to idle time; the
server releases them when that socket closes or switches sessions. Explicit
time-limited claims still expire through runtime cleanup. This prevents an
active client from losing control while preserving stale-token rejection after
release and fresh authority on reconnect.
Process restart clears callbacks and marks active work interrupted, preserving
ADR-81's no-restored-executable-authority rule.

*Consequences:* Transient transport loss can continue a paused approval with
the existing control frames. Durable deferred asks remain the PendingStore
path. This does not promise exactly-once external effects, cross-session
handoff, or recovery after process restart.

### ADR-84

**Interactive session working directory is persisted workspace state** — ✅

*Context:* A health-reused harness server can outlive the TUI process that first
started it. Binding every connection to the server's startup profile directory
therefore makes a later TUI launched from another project execute in the old
workspace. Mutating process-wide CWD is unsafe when one server hosts concurrent
sessions.

*Decision:* The TUI captures its launch directory once and sends it as an
optional absolute `working_dir` on hello and reconnect. The server validates and
canonicalizes an explicit directory, stores it in `Session.working_dir`, keeps it
when creating a session after profile switch, and restores it on resume. Interactive
tool contexts, project instructions, skill discovery/listing and command
discovery use that session value; Bash and default Glob execute there. Hello
without the field falls back to the selected profile's `working_dir`. Never call
`process.chdir` to represent client workspace state. `session_ready` and
`session_resumed` report the effective path.

*Consequences:* One reused server can safely host TUI sessions from different
directories without changing process-global state. The WS fields are additive;
legacy clients continue using profile defaults, and old sessions without the
persisted value use the resumed profile's default. Installed-binary/platform
acceptance remains separate (PT-013).

### ADR-85

**Automatic Town dispatch requires authoritative provider capacity** — ✅

*Context:* The Town orchestrator may start real worker work. Internal model-cost
estimates and token telemetry are neither a subscription quota nor an API
account's remaining allowance.

*Decision:* Automatic worker and orchestrator dispatch read capacity from the
selected provider and account scope, with source and freshness. Every applicable
provider window must have remaining capacity. Unknown, stale, unsupported,
exhausted or account-mismatched capacity queues the durable instruction/task.
Internal RunBudget remains a second runtime guard. v1 serializes automatic starts
per provider/account and does not claim a remote quota reservation it cannot make.

*Consequences:* A provider adapter needs evidence of its quota contract. Codex
uses its local app-server `account/rateLimits/read` only after account-scope
compatibility is proven. There is no guessed token balance or bypass to start
work while capacity is unknown.

*Addendum (2026-09-14, PT-060):* The automatic gate above remains unchanged. A
user may explicitly authorize one current-revision manual dispatch request for
an existing root, read-only Town orchestrator task. The measured quota snapshot
and status remain truthful and persisted; the request does not claim capacity
is available or reserved. That authorization may reach only direct child tasks
created by the live authorized planner through its bound Town tool context.
The root and children retain dependency, workspace, lease/concurrency, runtime,
approval, ACL and RunBudget checks. Scheduler retries, restart recovery, REST
child dispatch, grandchildren, continuations, and unrelated tasks never inherit
the authorization. The root planner remains read-only with Town-only tools.


### ADR-86

**Optional semantic decisions advise context and memory within existing authority** — ✅

*Context:* Optional skill/tool schemas and memory can consume context without
helping the current task. Focused typed judgments can inform selection, but
semantic relevance is neither execution authority nor evidence of truth.

*Decision:* Add a generic profile-owned decision interface with a Jev adapter.
Default configuration is disabled. Explicit outbound-state permission and a
credential environment-variable name are required for enabled remote inference.
Per-feature shadow mode preserves baseline behavior; enforce mode applies only
the configured bounded policy. Start operational rollout in shadow while
thresholds remain provisional. Main models still generate text; code validates
question/answer shapes, source identities, candidate scope and effects.

Maintain the full permitted tool registry independently from the selected
provider schemas, preserving explicit requests, controls, discovery recovery and
pending-call resume. Apply memory judgments only after scope/time filtering,
retain source provenance and taint, and preserve supported explicit user saves
through semantic outages. Retention may archive through reversible metadata or
record unresolved conflicts; it must never delete based on salience or invent a
supersession winner. Compaction supplements rather than displaces explicit pins.
Result/failure guidance cannot change executor evidence or replay denied, parked,
cancelled or effectful actions.

Bound outbound state, calls, bytes, tokens, time and cost. Missing required cost
pricing is unknown, not zero. Cancellation and policy/budget control failures
retain their normal force; ordinary inference failures use conservative
feature-specific fallbacks. Decision telemetry excludes raw state and secrets.
Existing ACLs, human decisions, provenance gates and provider-capacity admission
remain unchanged. No new authentication or UI authority is introduced.

*Consequences:* This is an additive exception to ADR-18, not a replacement for
structural retrieval, ADR-19 pins or durable history. Profile controls can disable
the service without deleting retained data. PT-068 tracks implementation and
automated/runtime acceptance; PT-069 tracks live calibration. The four synthetic
live cases on 2026-09-19 do not establish production quality or deployment.
See the [operator guide](jev-decision-layer.md) and
[acceptance specification](superpowers/specs/2026-09-19-jev-decision-layer-spec.md).

### ADR-87

**Profiles are configuration under `$HOME`; only mutable state follows `HARNESS_STATE_DIR`** — ✅

*Context:* `HARNESS_STATE_DIR` isolates mutable runtime state (runs, sessions,
projects, replays, usage, servers) for tests and side-by-side runtimes. Profile
lookup fallbacks (`~/.harness/profiles/<name>.yaml`) exist in delegate, REST run,
restart requeue and audit undo, while `profile-startup.ts` resolves the same
directory from `$HOME`. Routing only the fallbacks through the state root would
split-brain profile discovery: an isolated server would start from `$HOME`
profiles yet fail restart requeue with `profile not found on restart`, which is
the PT-059 failure mode.

*Decision:* Profile directories remain `$HOME`-relative configuration
(`~/.harness/profiles`, `profiles_dir`, explicit `--profiles`) and are never
resolved through `harnessStatePath`. Everything the runtime writes resolves via
`harnessStatePath`, including the server process registry. The root vitest
suite sets a fresh temporary `HARNESS_STATE_DIR` in a setup file unless one is
already set, so the suite must leave `~/.harness` untouched.

*Consequences:* Tests that seed or assert on state paths build them from
`harnessStatePath`, not `homedir()`/`HOME`. PT-071 records the isolation and the
zero-leak check; PT-059's lost run-record preimages remain unrecoverable.

### ADR-88

**Request routing is Jev judgments over the existing workflow runner, not a new graph engine** — 🔄

*Context:* A sketch proposed a Jev router over eight request categories feeding
six separate loops. Base already has a stage state machine (`runWorkflow`:
pointer, fail-back, tier promotion), per-domain playbooks, and a Jev
`WorkflowDecisionAdvisor` for in-playbook triage. The eight categories mixed two
axes (domain vs size), size is not knowable before recon, and a one-shot tree
has no path for drift, mixed domains, or clarification.

*Decision:* Split routing into independent typed judgments (domain Noul per
playbook, scale Score, existing-work, ambiguity, follow-up) composed by a pure
policy function; Jev also judges stage edges and delivery claims. LLMs do all
stage work; Jev never generates output. Planner/spec/analyser "loops" are
intensity presets of one runner, not separate loops. Recon stays a hard gate;
every Jev path falls back to today's behavior; each phase ships shadow first.

*Consequences:* New config is additive (`workflow.router`,
`decision_layer.features.{request_routing,edge_checks,claim_check}`).
Multi-domain runs sequentially in v1. Enforce mode is not recommended until live
evidence (PT-082). Spec: `superpowers/specs/2026-09-23-request-routing-graph-spec.md`.

### ADR-89

**Execution maps are bounded live observations, not inferred history** — ✅

*Context:* A workflow map must show the path a runner actually took. Existing
`Session.workflow_route` can describe a shadow recommendation, WebSocket
`stage` frames omit task/stage-attempt identity, and telemetry is aggregate
evidence rather than an ordered run ledger. Reconstructing a map from any of
them would turn advice or incomplete signals into false execution history.

*Decision:* The runner emits additive, identity-bearing workflow observations at
the control-flow sites that execute or close a pass/attempt/transition. A
server-owned in-process projection accepts only its exact
`run_id`/`session_id`/`profile` scope, uses monotonic revisions and event IDs,
and retains only the finite PT-084 limits. It may replay while the process owns
that projection; after restart it reports map history unavailable. Snapshots
and advice expose truncation, gaps, terminal/interrupted state, and
shadow/applied distinction explicitly. Routing aggregates remain separate,
scoped read-only statistics.

*Consequences:* The map cannot claim a path for flat-loop work, old runs, old
servers, or restarted processes. It adds no durable map store, routing policy,
execution engine, provider call, or client authority. PT-085 implements the
contract in `superpowers/specs/2026-09-23-workflow-map-spec.md`.


### ADR-90
**Closed-world read-only MCP effects are available before execution** — ✅

Context: document memory retrieval needs successive local search and graph reads.
An untrusted first result correctly taints the run, but an unfamiliar second tool
name was classified as outbound and denied before it could perform another read.

Decision: retain MCP annotations from listTools. Only the explicit combination
readOnlyHint=true, destructiveHint=false, openWorldHint=false declares a read
on the tool definition. The agent loop uses that declaration before provenance
checks and for execution/audit classification. Missing/open-world/contradictory
hints do not gain this override. These are operator-selected tool effect claims,
not a proof that arbitrary servers are safe or that their returned content is trusted.

Consequences: ACLs still apply, MCP results still taint runs, and outbound/destructive
actions still require the existing controls. Local document lookups can compose
without granting filesystem writes, deletion, or network actions. No client or
profile schema changes. Verified locally by PT-096, not released upstream.
