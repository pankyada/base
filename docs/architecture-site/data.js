/* data.js — The full architecture model for the Agent Harness.
 * Classic script (no modules): assigns window.ARCH.
 * Shape:
 *   layers: [ { id, title, accent, blurb, nodes: [ { id, name, files:[], responsibility, detail } ] } ]
 *   edges:  [ { from, to, kind } ]   kind: 'primary'|'data'|'optional'|'dependency'
 *   flow:   [ { step, fromId, toId, label, narrative } ]  ordered request lifecycle
 */
(function () {
  "use strict";

  window.ARCH = {
    layers: [
      {
        id: "clients",
        title: "Clients",
        accent: "#2563EB",
        blurb:
          "The surfaces a human — or another program — uses to talk to the harness: a terminal UI, a plain CLI, or a browser. All three are thin frontends over the same WS/REST protocol; none of them own any agent logic.",
        nodes: [
          {
            id: "tui",
            name: "Go TUI",
            files: ["tui/main.go", "tui/internal/ui/model.go", "tui/internal/setup/wizard.go"],
            responsibility: "Terminal UI client, primary dev surface.",
            detail:
              "A Go/Bubble Tea control surface. It opens a WebSocket to the server, streams assistant tokens live, and renders tool calls, memory, context gauges, approvals, skills, the deferred-asks inbox, and cost as interactive panes. A first-run setup wizard provisions ~/.harness/profiles/coding.yaml and its prompt file so a fresh install works with zero manual config."
          },
          {
            id: "cli",
            name: "Readline CLI",
            files: ["src/cli/index.ts"],
            responsibility: "Simple readline client.",
            detail:
              "A no-frills line-oriented client for scripting and quick checks. It reads a prompt from stdin, opens a WebSocket session, and prints streamed output — ideal for piping and automation."
          },
          {
            id: "web",
            name: "Web App (Next.js)",
            files: ["web/"],
            responsibility: "Browser client over REST.",
            detail:
              "A Next.js front end that talks to the harness over the REST API instead of a raw socket. It drives runs, streams responses, and surfaces projects and run history to a browser audience."
          },
          {
            id: "audit-cli",
            name: "harness audit CLI",
            files: ["src/cli/audit.ts"],
            responsibility: "Inspect and undo effectful tool calls.",
            detail:
              "`harness audit [--since] [--tool] [--undo <id>]` reads the append-only audit journal so a human can answer 'why did my assistant do that' by grep instead of by re-reading YAML, and reverse the last completed action where an inverse exists."
          }
        ]
      },
      {
        id: "transport",
        title: "Server / Transport (ws + http :7337)",
        accent: "#2563EB",
        blurb:
          "The front door. One process, one port, serving every profile it was pointed at. Authenticates connections, resolves which profile owns a request, and gives every conversation its own isolated Session.",
        nodes: [
          {
            id: "wss",
            name: "WS Server + Bearer Auth",
            files: ["src/server/index.ts"],
            responsibility: "WebSocket server; one Session per connection; binary audio frames.",
            detail:
              "Listens on :7337 and spins up exactly one Session per connection. When HARNESS_API_KEY is set it enforces Bearer auth on the handshake. Beyond text ClientMessage/ServerMessage frames it also relays binary audio_chunk / audio_out_chunk frames for voice-capable clients, and pushes a `pending` message listing this user's open deferred questions on every connect."
          },
          {
            id: "rest",
            name: "REST API",
            files: ["src/server/rest.ts"],
            responsibility: "/run /stream /health /runs /pending endpoints.",
            detail:
              "An HTTP surface for clients and automation that prefer request/response over sockets. Exposes POST /run (one-shot), POST /stream (SSE), GET /health, run lifecycle endpoints, and the deferred-asks surface: GET /pending, POST /runs/:id/input, DELETE /pending/:id. Headless runs auto-deny prompt-ACL tools — there is no interactive human to ask."
          },
          {
            id: "registry",
            name: "Profile Registry",
            files: ["src/profiles/registry.ts", "src/profiles/loader.ts", "src/profiles/schema.ts"],
            responsibility: "Loads a directory of profiles; routes by name.",
            detail:
              "Unlike a single-profile server, one harness process can load an entire directory of YAML profiles at once — each validated independently by a Zod schema, with a bad file logged and skipped rather than crashing the boot. A connection picks its profile via hello.profile, ?profile=, a trigger's owner, or a channel binding; an unknown name fails explicitly instead of silently falling back."
          },
          {
            id: "session",
            name: "Session",
            files: ["src/session/store.ts", "src/session/types.ts"],
            responsibility: "Per-connection, per-profile isolated conversation state.",
            detail:
              "Holds the live append-only message history, scoped memory handles, taint state (see Provenance Gate), and metadata for one conversation. Sessions, MCP client sets, tool views, and budgets are isolated per profile even though the server process is shared."
          }
        ]
      },
      {
        id: "core",
        title: "Core Agent Loop",
        accent: "#059669",
        blurb:
          "The engine. Streams the conversation to the model, fans out tool calls, keeps context in budget, routes work through adaptive stages, and retries transient failures.",
        nodes: [
          {
            id: "loop",
            name: "Agent Loop",
            files: ["src/loop/agent-loop.ts"],
            responsibility: "Streaming agentic loop; tool fan-out, ACL, gates, hooks, telemetry.",
            detail:
              "The heart of the runtime. It streams the model response, checks every effectful call against ACL, the provenance gate, and budget checkpoints, dispatches approved tool calls through hooks, feeds results back with their provenance, and loops until the model is done — recording telemetry, cost, and audit entries along the way."
          },
          {
            id: "ctx",
            name: "Context Projection",
            files: ["src/context/projection.ts", "src/context/estimator.ts"],
            responsibility: "Projects the append-only ledger into a budgeted provider request.",
            detail:
              "The session ledger is never mutated or truncated on disk — it is projected fresh each turn. A decay ladder elides restorable tool output to a handle first, then digests whole turns, and only drops the oldest turns as a bounded last resort — guaranteeing termination without silently rewriting history. Token counts are calibrated against real provider usage, not guessed."
          },
          {
            id: "workflow",
            name: "Adaptive Workflow Router",
            files: ["src/workflow/adaptive.ts", "src/workflow/triage.ts", "src/workflow/policy.ts", "src/workflow/runner.ts"],
            responsibility: "Optional recon→plan→design→build→verify→review staging with model-tier routing.",
            detail:
              "When a profile opts in, a request is triaged into a task class and intensity, then routed through bounded stage artifacts with model tier escalation (cheap → balanced → frontier → critic) driven by a learned routing policy, not a fixed model per task. Missing workflow: config preserves the flat loop exactly — this is additive, never a required indirection."
          },
          {
            id: "retry",
            name: "Retry (backoff)",
            files: ["src/loop/retry.ts"],
            responsibility: "Exponential backoff on transient LLM API errors.",
            detail:
              "Wraps the model call so transient failures — 429s, 5xx, dropped connections, timeouts — are retried with exponential backoff that respects Retry-After. Retries surface to the user so a slow upstream never silently stalls."
          },
          {
            id: "provider",
            name: "Provider Client",
            files: ["src/provider/client.ts"],
            responsibility: "OpenAI-compatible client, configurable base_url.",
            detail:
              "A thin wrapper over the OpenAI SDK pointed at any base_url, so the same loop runs against Anthropic, OpenAI, or any compatible endpoint. Model and API key are resolved per profile — a mixed fleet of profiles can each point at a different vendor from the same server process."
          }
        ]
      },
      {
        id: "safety",
        title: "Safety & Governance",
        accent: "#DC2626",
        blurb:
          "What makes unattended autonomy tolerable rather than reckless. Most agent frameworks stop at a static allow/deny list; this layer adds argument-aware conditions, a structural defense against prompt injection from content the agent read, a hard spend ceiling, and a complete undo-able paper trail — the actual differentiators from a typical harness.",
        nodes: [
          {
            id: "acl",
            name: "Conditional ACL",
            files: ["src/tools/acl.ts", "src/tools/predicates.ts"],
            responsibility: "allow / prompt / deny, plus argument-aware allow_if / deny_if.",
            detail:
              "A plain string ACL value works like any other harness. What's different: an ACL entry can instead be an object with allow_if / deny_if predicates over a closed, data-only set — equals, in_list, matches (glob), under_path (symlink-safe realpath containment), lt/gt, absent/present. No code evaluation, ever — a config file that can execute is a config file that can be exploited. deny always wins; unknown predicates fail profile load instead of silently widening access. This is what lets a profile say 'Notify: allow only to phone' or 'Write: allow only under $VAULT/inbox' instead of choosing between blanket allow and constant interruption."
          },
          {
            id: "provenance",
            name: "Provenance Gate",
            files: ["src/safety/provenance.ts", "src/safety/rules.ts", "src/safety/classifier.ts"],
            responsibility: "Structural defense: content the agent read can never silently authorize an action.",
            detail:
              "Every tool result carries a provenance tag — untrusted by default for anything network- or channel-sourced. A monotonic per-turn taint flag is stored on the ledger itself (not derived, so context projection can't accidentally un-taint it) and resets only on a genuine human message. When a turn is tainted, outbound/destructive tools escalate to approval regardless of ACL — and neither conditional predicates nor yolo mode can bypass that escalation. This is the structural answer to the fact that once an agent reads a web page or an inbound channel message, its context contains instructions from strangers that are token-indistinguishable from the user's — prompt-level defenses alone are probabilistic, this closes the path mechanically. Backed by a permanent, only-grows red-team corpus in CI."
          },
          {
            id: "budget",
            name: "Autonomy Budget",
            files: ["src/runs/budget.ts"],
            responsibility: "Hard cost / tool-count / wall-time ceiling on unattended runs.",
            detail:
              "Checked before every model call and every tool call — never only at the end of a turn, which would be a receipt, not a budget. Fails closed: an unreadable or malformed budget is treated as zero and the run refuses to start. Delegated sub-agents share the parent's actual remaining ledger object rather than getting a fresh allowance, so fan-out can't multiply spend. On exceed, the run aborts with partial work preserved and inspectable, and the channel runtime notifies what was spent and what was in flight."
          },
          {
            id: "audit",
            name: "Audit Journal + Undo",
            files: ["src/audit/journal.ts", "src/audit/undo.ts", "src/audit/query.ts"],
            responsibility: "Append-only per-action record with reason, plus best-effort inverse.",
            detail:
              "Distinct from telemetry on purpose: telemetry is sampled and disposable, the audit journal is complete, per-action JSONL, and the thing you read at 3am when something went wrong. Every effectful call records decided_by (default / predicate / mode / human / gate) and decided_reason — so 'why did my assistant send that' is answerable by grep, never by re-reading YAML. Core ships inverses for its own tools (Write, MemoryWrite, MemoryDelete); other tools may attach their own undo descriptor, and entries without one are honestly reported as not-undoable rather than silently ignored."
          },
          {
            id: "hooks",
            name: "Hooks Runner",
            files: ["src/hooks/runner.ts"],
            responsibility: "pre_tool / post_tool / on_stop shell hooks.",
            detail:
              "Runs user-defined shell hooks around the lifecycle: pre_tool before a tool executes, post_tool after, and on_stop at session end. Hooks receive context via env vars like TOOL_NAME and TOOL_OK for side effects and policy that live outside the harness entirely."
          },
          {
            id: "modes",
            name: "Instance Modes",
            files: ["src/profiles/schema.ts"],
            responsibility: "developer / analyst / assistant / production default postures.",
            detail:
              "One profile field sets sane defaults across ACL strictness, the provenance gate, and approval posture instead of hand-tuning a dozen fields per deployment shape. Explicit profile-level overrides always win over mode defaults — modes set the floor, not a ceiling."
          }
        ]
      },
      {
        id: "tools",
        title: "Tools & Execution",
        accent: "#059669",
        blurb:
          "How the agent acts on the world once governance has approved a call — a registry of built-ins, MCP tools, and sub-agents, with sandboxed code execution for anything untrusted.",
        nodes: [
          {
            id: "toolreg",
            name: "Tool Registry",
            files: ["src/tools/registry.ts", "src/tools/builtin/index.ts"],
            responsibility: "Global tool registry.",
            detail:
              "The single catalog of every callable tool — built-ins, MCP tools, and sub-agent delegation. registerAll() wires the built-ins at startup, and the loop looks up handlers and schemas here when the model asks for a tool."
          },
          {
            id: "builtins",
            name: "Built-in Tools",
            files: [
              "src/tools/builtin/bash.ts",
              "src/tools/builtin/edit.ts",
              "src/tools/builtin/read.ts",
              "src/tools/builtin/notify.ts",
              "src/tools/builtin/recall.ts",
              "src/tools/builtin/ask-user.ts"
            ],
            responsibility: "Bash, Edit, Read, Grep, Memory, Recall, Notify, AskUser, Todo, etc.",
            detail:
              "The baseline toolbox shipped with the harness — file read/edit/write, shell, search, memory read/write, time-aware Recall, todos, plus two automation-facing tools: Notify (send over a bound channel, gated by conditional ACL) and AskUser (interactive by default, or defer: true to park as a durable pending question)."
          },
          {
            id: "executor",
            name: "Executor Factory",
            files: [
              "src/executor/factory.ts",
              "src/executor/docker.ts",
              "src/executor/wasm.ts"
            ],
            responsibility: "Sandboxed code execution (Docker / WASM / E2B / Daytona).",
            detail:
              "Provides isolated runtimes for executing arbitrary code safely. The factory picks a backend — a Docker container, a WASM sandbox, or a hosted sandbox provider — so the execute-code tool can run untrusted code without touching the host."
          },
          {
            id: "effects",
            name: "Tool Effect Classifier",
            files: ["src/tools/effects.ts"],
            responsibility: "Classifies each tool as read / write / outbound / destructive.",
            detail:
              "A tool's declared effect class is what the audit journal records and what the provenance gate checks against — a network-facing Notify call and a local Read are governed very differently even though both are 'just tools' to the model."
          }
        ]
      },
      {
        id: "ext",
        title: "Extensibility",
        accent: "#7C3AED",
        blurb:
          "The plug-in surface. Skills inject expertise, MCP adds external tools, custom tools and memory providers are dropped into a directory, and sub-agents let the agent delegate work — all without touching core.",
        nodes: [
          {
            id: "skills",
            name: "Skills",
            files: ["src/skills/loader.ts", "src/skills/indexer.ts"],
            responsibility: "Auto-discovered SKILL.md dirs, injected into system prompt.",
            detail:
              "Discovers SKILL.md directories across four path levels (user, project, sub-project, folder) with last-write-wins. The indexer summarises them into the system prompt so the model knows what skills exist and when to reach for them."
          },
          {
            id: "customtools",
            name: "Custom Tool Loader",
            files: ["src/tools/loader.ts"],
            responsibility: "Auto-registers .agents/tools/**/*.{ts,js}.",
            detail:
              "Drop a file into .agents/tools/ across the same four discovery levels as skills and it's registered automatically — no profile edit, no core change, no restart-and-hope."
          },
          {
            id: "mcp",
            name: "MCP Client",
            files: ["src/mcp/client.ts"],
            responsibility: "Connects MCP servers (stdio/http/sse/ws); tools as serverName__toolName.",
            detail:
              "Connects to Model Context Protocol servers over stdio, streamable-http, SSE, or WebSocket. Lists each server's tools and exposes them in the registry as serverName__toolName with real parameter schemas. Clients lazy-connect and idle-close under a global concurrency cap so a multi-profile server doesn't hold N MCP subprocess sets open at once."
          },
          {
            id: "agents",
            name: "Sub-Agents",
            files: [
              "src/agents/runner.ts",
              "src/agents/loader.ts",
              "src/tools/builtin/delegate.ts",
              "src/tools/builtin/delegate-fanout.ts"
            ],
            responsibility: "Delegate + fanout to worker agents, sharing the parent's budget.",
            detail:
              "Lets an orchestrator agent spawn worker agents with their own profiles. delegate runs one worker to completion; delegate-fanout runs several in parallel and gathers results — the basis for multi-agent research patterns. Every worker shares the parent's remaining autonomy budget rather than getting a fresh one."
          }
        ]
      },
      {
        id: "memory",
        title: "Memory",
        accent: "#B45309",
        blurb:
          "Where the agent's durable knowledge lives — and, unlike most harnesses' eternal key→content stores, where it stops being confidently stale.",
        nodes: [
          {
            id: "fsmem",
            name: "FS / Graph Memory",
            files: ["src/memory/fs-memory.ts", "src/memory/graph-memory.ts", "src/memory/interface.ts"],
            responsibility: "Profile + session/user scoped memory, two pluggable backends.",
            detail:
              "Two providers behind one interface, chosen per profile with provider: 'fs'|'graph'. fs-memory stores notes as markdown with gray-matter frontmatter under the artifact dir; graph-memory keeps typed relation links between nodes for bidirectional traversal (MemoryLinked). Memory is two-tier: shared profile-scope plus private per-user scope, merged into one system prompt section, so a single server instance serves multiple users with no cross-contamination."
          },
          {
            id: "temporal",
            name: "Temporal Memory + Recall",
            files: ["src/memory/temporal.ts", "src/memory/recurrence.ts", "src/memory/query.ts"],
            responsibility: "Validity intervals, recurrence, and supersession — memory that knows what time it is.",
            detail:
              "Eternal-key memory is wrong for almost everything an assistant learns: a flight date, a manager who changes in March, last quarter's budget. Optional frontmatter (valid_from, valid_until, recur, entity, confidence, supersedes) is fully backward compatible — an old file with none of these fields still means exactly what it meant before. The Recall tool answers 'what is true at time T': it filters by validity window before ranking, collapses superseded facts to the current answer per entity while keeping history queryable at a past instant, and feeds context projection expired-first eviction plus imminent-fact pinning. Recurrence supports a bounded RRULE subset (no external dependency) with explicit DST- and leap-day-correct expansion — the two bugs that break almost every hand-rolled recurrence implementation."
          }
        ]
      },
      {
        id: "unattended",
        title: "Unattended & Ambient Automation",
        accent: "#DC2626",
        blurb:
          "Seven primitives that let a profile run without a human watching, reach a human when it needs to, ask a question that outlives the process, and act within bounds — the track that turns a chat tool into a background agent. No vendor or life-domain vocabulary lives in this layer; it stays profile-agnostic and CI-enforced (see the boundary guard below).",
        nodes: [
          {
            id: "triggers",
            name: "Trigger Manager",
            files: ["src/triggers/manager.ts", "src/triggers/cron.ts", "src/triggers/watch.ts", "src/triggers/poll.ts", "src/triggers/cursors.ts"],
            responsibility: "Cron, filesystem watch, and cursor-based poll — unified, with a free no-change path.",
            detail:
              "Cron approximates 'wake me when something changes' badly — 'check my inbox' becomes 288 wasted model turns a day at 5-minute granularity. watch (chokidar, debounced, batch-capped, self-write-suppressed so a run can't retrigger itself) and poll (interval + persisted cursor) both fire only when something actually changed. The poll probe is a single deterministic tool call with zero model calls on the unchanged-cursor path — turning near-continuous polling into near-zero cost. Per-trigger overlap policy (skip/queue/parallel) and a global concurrency cap protect a laptop-class box; skip_reason telemetry is the operational health signal for the whole automation layer."
          },
          {
            id: "pending",
            name: "Deferred Asks (Pending Store)",
            files: ["src/runs/pending.ts", "src/runs/park.ts", "src/runs/resume.ts"],
            responsibility: "A question that survives hours, channels, and process restarts.",
            detail:
              "In most harnesses, AskUser awaits an in-memory promise held by a live connection — no client means no question, and a restart destroys it along with the work already paid for. Here, AskUser({defer:true}) parks the run to disk with a new waiting_input status, delivers the question over a bound channel, and resumes — hours or days later, across a full server restart — reading state purely from the pending store and the append-only session ledger, with a TTL expiry sentinel and full cancellation. As far as the model is concerned, the answer arrives 'as if instant'."
          },
          {
            id: "channels",
            name: "Channels",
            files: ["src/channels/runtime.ts", "src/channels/bindings.ts", "src/channels/loader.ts", "src/channels/types.ts"],
            responsibility: "A named, pluggable, bidirectional transport between a profile and a human.",
            detail:
              "Closes the gap where a triggered run is write-only — it can spend tokens but couldn't report, ask, or be approved. An adapter is an opaque interface (send / receive / capability-describe); core ships only stdout and webhook reference adapters and knows nothing about any specific vendor — that boundary is CI-enforced, not just a convention. Persistent bindings route a user to paired/open/off channels with fail-closed handling for unbound inbound messages, capability degradation (a text-only channel silently drops what it can't render), chunking for length limits, and rate limiting. Approvals and deferred-ask delivery both ride this same transport."
          },
          {
            id: "cond-autonomy",
            name: "Predicate Lists",
            files: ["src/tools/predicates.ts", "src/profiles/schema.ts"],
            responsibility: "lists: sourced from profile or memory, feeding Conditional ACL.",
            detail:
              "A list like trusted_channels or trusted_contacts can live directly in the profile or be sourced from a memory key the agent and user maintain over time — with a short cache, and a read failure denies rather than silently falling through to the ACL default. This is the piece that lets 'always allow this channel' grow safely instead of turning into a static, stale allowlist."
          }
        ]
      },
      {
        id: "voice",
        title: "Voice",
        accent: "#2563EB",
        blurb:
          "Streaming audio in and out, as a pair of pluggable interfaces — core gains no audio codec or vendor dependency, only the protocol.",
        nodes: [
          {
            id: "voicesession",
            name: "Voice Turn + Endpointing",
            files: ["src/voice/session.ts", "src/voice/stream.ts"],
            responsibility: "Streaming STT in, sentence-chunked TTS out, barge-in cancellation.",
            detail:
              "Binary audio_chunk frames feed a streaming STT provider with silence-based endpointing; model output is chunked at sentence boundaries and streamed to TTS as it's generated rather than waiting for the full turn. Barge-in cancels synthesis, playback, and the in-flight LLM turn together, appending an interrupted-marked partial to the ledger instead of losing or duplicating the turn."
          },
          {
            id: "voiceplugins",
            name: "Voice Provider Loader",
            files: ["src/voice/loader.ts", "src/voice/registry.ts", "src/voice/types.ts"],
            responsibility: "STT/TTS as interfaces only; providers load from .agents/voice/.",
            detail:
              "Speech-to-text and text-to-speech are typed interfaces core defines and never implements — an actual provider is a plugin dropped in .agents/voice/, selected by name in the profile. system_prompt_voice lets a profile use a shorter, speech-appropriate prompt variant chosen by the connecting channel's capability."
          }
        ]
      },
      {
        id: "state",
        title: "State & Persistence",
        accent: "#B45309",
        blurb:
          "Everything the harness remembers — memory, sessions, runs, projects, usage, telemetry, and the audit trail, all on disk under ~/.harness.",
        nodes: [
          {
            id: "sessions",
            name: "Session Store",
            files: ["src/session/store.ts"],
            responsibility: "Sessions persisted to ~/.harness/sessions.",
            detail:
              "Serialises each conversation to ~/.harness/sessions/<date>_<id>.json as an append-only ledger so it can be replayed, audited, resumed after a park, or reflected on later. The improver reads these records after a session ends."
          },
          {
            id: "runs",
            name: "Run Store",
            files: ["src/runs/store.ts", "src/runs/types.ts"],
            responsibility: "Run records, including waiting_input and budget_exceeded states.",
            detail:
              "Records every run triggered through REST, a trigger, or a channel — inputs, status, and outputs — with statuses including waiting_input (a deferred question is open) and budget_exceeded. This gives schedulers and the web client a durable history of what was executed, when, and why it stopped."
          },
          {
            id: "projects",
            name: "Project Store",
            files: ["src/projects/store.ts"],
            responsibility: "Project records.",
            detail:
              "Persists project records that group related runs and configuration. The REST layer reads and writes these so the web app can organise work into named projects."
          },
          {
            id: "usage",
            name: "Usage Ledger + Cost Table",
            files: ["src/usage/ledger.ts", "src/models/registry.ts"],
            responsibility: "Per-user usage + per-model cost estimation.",
            detail:
              "Tracks token consumption per user in a ledger and estimates spend using a per-model cost table (with a fallback for unknown models). The loop feeds it input/output token counts after every turn, and the autonomy budget reads it at every checkpoint."
          },
          {
            id: "telemetry",
            name: "Telemetry (JSONL)",
            files: ["src/telemetry/logger.ts", "src/telemetry/query.ts"],
            responsibility: "Sampled JSONL events to ~/.harness/telemetry.jsonl.",
            detail:
              "Appends structured events — tool calls, errors, timings, trigger fire/skip reasons — as JSONL. Deliberately sampled and disposable, unlike the complete, per-action audit journal above it."
          }
        ]
      },
      {
        id: "ops",
        title: "Self-Improvement",
        accent: "#7C3AED",
        blurb:
          "The reflective edge — the harness learns from finished sessions instead of repeating the same lesson every time.",
        nodes: [
          {
            id: "improver",
            name: "Improver",
            files: ["src/improver/default-improver.ts"],
            responsibility: "Post-session reflection -> memory writes + skill mining.",
            detail:
              "After a session ends, it reflects on the transcript and writes durable lessons back to memory — attaching temporal validity when the source text implies one. Every N sessions it mines recurring patterns into proposed skills for human review, so the harness gradually gets better at its work without silently self-modifying."
          }
        ]
      },
      {
        id: "external",
        title: "External",
        accent: "#7C3AED",
        blurb:
          "The systems beyond the harness boundary — the language model itself, third-party MCP servers, and whatever sits behind a channel adapter.",
        nodes: [
          {
            id: "llm",
            name: "LLM API",
            files: [],
            responsibility: "Anthropic / OpenAI-compatible endpoint.",
            detail:
              "The actual model behind the curtain, reached over an OpenAI-compatible HTTP API. Which provider and model is purely a profile choice; the harness treats it as a streaming completion endpoint."
          },
          {
            id: "mcpservers",
            name: "MCP Servers",
            files: [],
            responsibility: "Remote/local MCP servers.",
            detail:
              "External Model Context Protocol servers — local subprocesses or remote services — that expose extra tools and resources. The MCP client connects to them and brings their tools into the agent's reach."
          },
          {
            id: "endpoints",
            name: "Channel Endpoints",
            files: [],
            responsibility: "Whatever a channel adapter actually talks to.",
            detail:
              "The human-facing side of a channel binding — a phone, a webhook consumer, a messaging platform. Core never names one; that vendor logic lives entirely in a custom adapter under .agents/channels/."
          }
        ]
      }
    ],

    edges: [
      { from: "tui", to: "wss", kind: "primary" },
      { from: "cli", to: "wss", kind: "primary" },
      { from: "web", to: "rest", kind: "primary" },
      { from: "audit-cli", to: "audit", kind: "primary" },
      { from: "wss", to: "session", kind: "primary" },
      { from: "rest", to: "session", kind: "primary" },
      { from: "registry", to: "session", kind: "dependency" },
      { from: "session", to: "loop", kind: "primary" },
      { from: "loop", to: "ctx", kind: "primary" },
      { from: "loop", to: "workflow", kind: "optional" },
      { from: "loop", to: "provider", kind: "primary" },
      { from: "provider", to: "retry", kind: "dependency" },
      { from: "retry", to: "llm", kind: "data" },
      { from: "loop", to: "toolreg", kind: "primary" },
      { from: "toolreg", to: "acl", kind: "primary" },
      { from: "acl", to: "provenance", kind: "primary" },
      { from: "provenance", to: "budget", kind: "primary" },
      { from: "budget", to: "builtins", kind: "primary" },
      { from: "acl", to: "hooks", kind: "dependency" },
      { from: "loop", to: "audit", kind: "data" },
      { from: "acl", to: "cond-autonomy", kind: "dependency" },
      { from: "modes", to: "acl", kind: "dependency" },
      { from: "builtins", to: "executor", kind: "data" },
      { from: "builtins", to: "effects", kind: "dependency" },
      { from: "toolreg", to: "mcp", kind: "optional" },
      { from: "toolreg", to: "agents", kind: "optional" },
      { from: "mcp", to: "mcpservers", kind: "data" },
      { from: "skills", to: "loop", kind: "dependency" },
      { from: "customtools", to: "toolreg", kind: "dependency" },
      { from: "agents", to: "loop", kind: "optional" },
      { from: "agents", to: "budget", kind: "dependency" },
      { from: "session", to: "fsmem", kind: "data" },
      { from: "fsmem", to: "temporal", kind: "dependency" },
      { from: "builtins", to: "temporal", kind: "data" },
      { from: "session", to: "sessions", kind: "data" },
      { from: "loop", to: "telemetry", kind: "data" },
      { from: "loop", to: "usage", kind: "data" },
      { from: "rest", to: "runs", kind: "data" },
      { from: "rest", to: "projects", kind: "data" },
      { from: "rest", to: "pending", kind: "primary" },
      { from: "wss", to: "pending", kind: "primary" },
      { from: "builtins", to: "pending", kind: "data" },
      { from: "pending", to: "channels", kind: "primary" },
      { from: "builtins", to: "channels", kind: "optional" },
      { from: "budget", to: "channels", kind: "optional" },
      { from: "channels", to: "endpoints", kind: "data" },
      { from: "triggers", to: "rest", kind: "optional" },
      { from: "triggers", to: "budget", kind: "dependency" },
      { from: "wss", to: "voicesession", kind: "optional" },
      { from: "voicesession", to: "voiceplugins", kind: "dependency" },
      { from: "session", to: "improver", kind: "optional" },
      { from: "improver", to: "fsmem", kind: "data" }
    ],

    flow: [
      {
        step: 1,
        fromId: "tui",
        toId: "wss",
        label: "user sends message over WebSocket",
        narrative:
          "A client — here the Go/Bubble Tea TUI — opens a WebSocket to :7337 and sends the user's message as a ClientMessage frame."
      },
      {
        step: 2,
        fromId: "wss",
        toId: "session",
        label: "server authenticates and routes to an isolated per-profile Session",
        narrative:
          "The server checks Bearer auth (when HARNESS_API_KEY is set), resolves which profile owns this connection via the Profile Registry, and routes the frame to that connection's isolated Session."
      },
      {
        step: 3,
        fromId: "session",
        toId: "loop",
        label: "Session hands the user message to the Agent Loop",
        narrative:
          "The Session appends the message to its append-only history and invokes the Agent Loop to produce the next assistant turn."
      },
      {
        step: 4,
        fromId: "loop",
        toId: "ctx",
        label: "loop projects the ledger into a budgeted request",
        narrative:
          "Context Projection turns the durable ledger into a bounded provider request — eliding restorable tool output, digesting old turns, never mutating the ledger itself."
      },
      {
        step: 5,
        fromId: "loop",
        toId: "provider",
        label: "loop streams the projected conversation to the Provider Client",
        narrative:
          "The loop assembles the system prompt, tools, and projected history and hands them to the Provider Client for a streaming completion."
      },
      {
        step: 6,
        fromId: "provider",
        toId: "llm",
        label: "request goes to the LLM API (with retry/backoff on transient errors)",
        narrative:
          "The Provider Client calls the OpenAI-compatible LLM API, retrying with exponential backoff on 429s, 5xx, and dropped connections."
      },
      {
        step: 7,
        fromId: "llm",
        toId: "loop",
        label: "LLM streams back text and tool calls",
        narrative:
          "The model streams tokens back; the loop relays assistant text to the client and collects any requested tool calls."
      },
      {
        step: 8,
        fromId: "loop",
        toId: "toolreg",
        label: "loop dispatches tool calls to the Tool Registry",
        narrative:
          "For each tool call, the loop looks up the handler in the Tool Registry — a built-in, an MCP tool, or a sub-agent delegation."
      },
      {
        step: 9,
        fromId: "toolreg",
        toId: "acl",
        label: "each call is checked against ACL, then the provenance gate, then budget",
        narrative:
          "The call resolves to allow/prompt/deny — including any argument-aware predicate — then, if the turn is tainted by untrusted content, escalates through the provenance gate regardless of ACL, then checks the autonomy budget before executing."
      },
      {
        step: 10,
        fromId: "budget",
        toId: "builtins",
        label: "approved tools execute (with pre/post hooks); results return with their provenance",
        narrative:
          "Approved tools run — wrapped by pre_tool and post_tool hooks — and their results, tagged trusted or untrusted, are fed back into the loop and appended to the audit journal."
      },
      {
        step: 11,
        fromId: "loop",
        toId: "session",
        label: "final assistant message is stored; telemetry, usage, and audit recorded",
        narrative:
          "When the model finishes, the final assistant message is stored on the Session and persisted, while telemetry, token usage, and the audit trail are recorded — or, if AskUser deferred, the run parks as waiting_input until a channel delivers an answer."
      }
    ]
  };
})();
