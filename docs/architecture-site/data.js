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
          "The surfaces a human (or another program) uses to talk to the harness — a terminal UI, a plain CLI, or the browser.",
        nodes: [
          {
            id: "tui",
            name: "Go TUI",
            files: ["tui/main.go", "tui/internal/ui/model.go"],
            responsibility: "Terminal UI client.",
            detail:
              "A Go/Bubble Tea control surface. It opens a WebSocket to the server, streams assistant tokens live, and renders tool calls, memory, approvals, skills, and context as interactive panes."
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
          }
        ]
      },
      {
        id: "transport",
        title: "Server / Transport (ws:7337)",
        accent: "#2563EB",
        blurb:
          "The front door. Authenticates connections, validates the active profile, and gives every conversation its own Session.",
        nodes: [
          {
            id: "wss",
            name: "WS Server + Bearer Auth",
            files: ["src/server/index.ts"],
            responsibility: "WebSocket server; one Session per connection.",
            detail:
              "Listens on ws:7337 and spins up exactly one Session per connection. When HARNESS_API_KEY is set it enforces Bearer auth on the handshake, then relays ClientMessage/ServerMessage frames between the client and the agent loop."
          },
          {
            id: "rest",
            name: "REST API",
            files: ["src/server/rest.ts"],
            responsibility: "/run /stream /health endpoints.",
            detail:
              "An HTTP surface for clients that prefer request/response over sockets. It exposes /run and /stream to execute and stream agent turns and /health for liveness, backing the Next.js web client."
          },
          {
            id: "session",
            name: "Session",
            files: ["src/session/store.ts", "src/session/types.ts"],
            responsibility: "Per-connection conversation state.",
            detail:
              "Holds the live message history, scoped memory handles, and metadata for a single conversation. It is the bridge object the transport hands to the agent loop and persists to the session store."
          },
          {
            id: "profile",
            name: "Profile Loader (Zod)",
            files: ["src/profiles/schema.ts", "src/profiles/loader.ts"],
            responsibility: "YAML profile config validated by Zod.",
            detail:
              "Loads the active YAML profile and validates it against a Zod schema before anything runs. The profile drives everything — model, tools, ACLs, skills, MCP servers, hooks, and agents — so this is the config source of truth."
          }
        ]
      },
      {
        id: "core",
        title: "Core Agent Loop",
        accent: "#059669",
        blurb:
          "The engine. Streams the conversation to the model, fans out tool calls, keeps context in budget, and retries transient failures.",
        nodes: [
          {
            id: "loop",
            name: "Agent Loop",
            files: ["src/loop/agent-loop.ts"],
            responsibility: "Streaming agentic loop; tool fan-out, ACL, hooks, telemetry.",
            detail:
              "The heart of the runtime. It streams the model response, dispatches any tool calls through the ACL and hooks, feeds results back, and loops until the model is done — recording telemetry and usage along the way."
          },
          {
            id: "ctx",
            name: "Context Manager",
            files: ["src/loop/context-manager.ts"],
            responsibility: "Condenses messages when context exceeds budget.",
            detail:
              "Watches the running token footprint and compresses or summarises older turns when the conversation grows past the model's budget. This keeps long sessions coherent without blowing the context window."
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
              "A thin wrapper over the OpenAI SDK pointed at any base_url, so the same loop runs against Anthropic, OpenAI, or any compatible endpoint. Model and API key are resolved per profile."
          }
        ]
      },
      {
        id: "tools",
        title: "Tools & Execution",
        accent: "#059669",
        blurb:
          "How the agent acts on the world — a registry of tools, gated by ACLs and hooks, with sandboxed code execution.",
        nodes: [
          {
            id: "registry",
            name: "Tool Registry",
            files: ["src/tools/registry.ts", "src/tools/builtin/index.ts"],
            responsibility: "Global tool registry.",
            detail:
              "The single catalog of every callable tool — built-ins, MCP tools, and sub-agent delegation. registerAll() wires the built-ins at startup, and the loop looks up handlers and schemas here when the model asks for a tool."
          },
          {
            id: "acl",
            name: "ACL",
            files: ["src/tools/acl.ts"],
            responsibility: "Allow / prompt / deny resolution per profile.",
            detail:
              "Decides, per tool call, whether it runs automatically, asks the user first, or is blocked. Resolution reads the profile's tools.builtin map for built-ins and tools.mcp_servers[].acl for MCP, with a wildcard fallback."
          },
          {
            id: "builtins",
            name: "Built-in Tools",
            files: [
              "src/tools/builtin/bash.ts",
              "src/tools/builtin/edit.ts",
              "src/tools/builtin/read.ts",
              "src/tools/builtin/grep.ts"
            ],
            responsibility: "Bash, Edit, Read, Grep, Memory, Todo, etc.",
            detail:
              "The baseline toolbox shipped with the harness — file read/edit/write, shell, search, memory operations, todos, and more. These are the primitives the agent composes to actually get work done."
          },
          {
            id: "hooks",
            name: "Hooks Runner",
            files: ["src/hooks/runner.ts"],
            responsibility: "pre_tool / post_tool / on_stop shell hooks.",
            detail:
              "Runs user-defined shell hooks around the lifecycle: pre_tool before a tool executes, post_tool after, and on_stop at session end. Hooks receive context via env vars like TOOL_NAME and TOOL_OK for side effects and policy."
          },
          {
            id: "executor",
            name: "Executor Factory",
            files: [
              "src/executor/factory.ts",
              "src/executor/docker.ts",
              "src/executor/wasm.ts"
            ],
            responsibility: "Sandboxed code execution (Docker / WASM).",
            detail:
              "Provides isolated runtimes for executing arbitrary code safely. The factory picks a backend — a Docker container or a WASM sandbox — so the execute-code tool can run untrusted code without touching the host."
          }
        ]
      },
      {
        id: "ext",
        title: "Extensibility",
        accent: "#7C3AED",
        blurb:
          "The plug-in surface. Skills inject expertise, MCP adds external tools, and sub-agents let the agent delegate work.",
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
            id: "mcp",
            name: "MCP Client",
            files: ["src/mcp/client.ts"],
            responsibility: "Connects MCP servers (stdio/http/sse/ws); tools as serverName__toolName.",
            detail:
              "Connects to Model Context Protocol servers over stdio, streamable-http, SSE, or WebSocket. It lists each server's tools and exposes them in the registry as serverName__toolName, passing through real parameter schemas."
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
            responsibility: "Delegate + fanout to worker agents.",
            detail:
              "Lets an orchestrator agent spawn worker agents with their own profiles. delegate runs one worker to completion; delegate-fanout runs several in parallel and gathers results — the basis for multi-agent research patterns."
          }
        ]
      },
      {
        id: "state",
        title: "State & Persistence",
        accent: "#B45309",
        blurb:
          "Everything the harness remembers — memory, sessions, runs, projects, usage, and telemetry on disk.",
        nodes: [
          {
            id: "memory",
            name: "Memory (FS/Graph)",
            files: ["src/memory/fs-memory.ts", "src/memory/graph-memory.ts"],
            responsibility: "Profile + session/user scoped memory.",
            detail:
              "Two memory providers behind one interface. fs-memory stores profile-scoped and session-scoped notes as markdown under the artifact dir; graph-memory keeps linked, queryable memory for richer recall across sessions."
          },
          {
            id: "sessions",
            name: "Session Store",
            files: ["src/session/store.ts"],
            responsibility: "Sessions persisted to ~/.harness/sessions.",
            detail:
              "Serialises each conversation to ~/.harness/sessions/<date>_<id>.json so it can be replayed, audited, or reflected on later. The improver reads these records after a session ends."
          },
          {
            id: "runs",
            name: "Run Store",
            files: ["src/runs/store.ts"],
            responsibility: "Run records.",
            detail:
              "Records discrete runs triggered through the REST API — their inputs, status, and outputs. This gives the web client and schedulers a durable history of what was executed and when."
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
            files: ["src/usage/ledger.ts", "src/loop/agent-loop.ts"],
            responsibility: "Per-user usage + per-model cost estimation.",
            detail:
              "Tracks token consumption per user in a ledger and estimates spend using a per-model cost table (with a fallback for unknown models). The loop feeds it input/output token counts after every turn."
          },
          {
            id: "telemetry",
            name: "Telemetry (JSONL)",
            files: ["src/telemetry/logger.ts", "src/telemetry/query.ts"],
            responsibility: "JSONL events to ~/.harness/telemetry.jsonl.",
            detail:
              "Appends structured events — tool calls, errors, timings — as JSONL to ~/.harness/telemetry.jsonl. The query module reads that log back for analysis and dashboards."
          }
        ]
      },
      {
        id: "ops",
        title: "Scheduling & Self-Improvement",
        accent: "#2563EB",
        blurb:
          "The autonomous edge — cron triggers fire runs on a schedule, and the improver learns from finished sessions.",
        nodes: [
          {
            id: "cron",
            name: "Cron Scheduler",
            files: ["src/scheduler/cron.ts"],
            responsibility: "Cron triggers from profile.",
            detail:
              "Reads cron triggers declared in the profile and fires runs on schedule without a human in the loop. Triggered runs flow through the REST layer just like manual ones."
          },
          {
            id: "improver",
            name: "Improver",
            files: ["src/improver/default-improver.ts"],
            responsibility: "Post-session reflection -> memory writes + skill mining.",
            detail:
              "After a session ends, it reflects on the transcript and writes durable lessons back to memory. Every N sessions it mines recurring patterns into proposed skills, so the harness gradually gets better at its work."
          }
        ]
      },
      {
        id: "external",
        title: "External",
        accent: "#7C3AED",
        blurb:
          "The systems beyond the harness boundary — the language model itself and any third-party MCP servers.",
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
          }
        ]
      }
    ],

    edges: [
      { from: "tui", to: "wss", kind: "primary" },
      { from: "cli", to: "wss", kind: "primary" },
      { from: "web", to: "rest", kind: "primary" },
      { from: "wss", to: "session", kind: "primary" },
      { from: "rest", to: "session", kind: "primary" },
      { from: "profile", to: "session", kind: "dependency" },
      { from: "session", to: "loop", kind: "primary" },
      { from: "loop", to: "ctx", kind: "primary" },
      { from: "loop", to: "provider", kind: "primary" },
      { from: "provider", to: "retry", kind: "dependency" },
      { from: "retry", to: "llm", kind: "data" },
      { from: "loop", to: "registry", kind: "primary" },
      { from: "registry", to: "acl", kind: "primary" },
      { from: "acl", to: "builtins", kind: "primary" },
      { from: "acl", to: "hooks", kind: "dependency" },
      { from: "builtins", to: "executor", kind: "data" },
      { from: "registry", to: "mcp", kind: "optional" },
      { from: "registry", to: "agents", kind: "optional" },
      { from: "mcp", to: "mcpservers", kind: "data" },
      { from: "skills", to: "loop", kind: "dependency" },
      { from: "agents", to: "loop", kind: "optional" },
      { from: "session", to: "memory", kind: "data" },
      { from: "session", to: "sessions", kind: "data" },
      { from: "loop", to: "telemetry", kind: "data" },
      { from: "loop", to: "usage", kind: "data" },
      { from: "builtins", to: "memory", kind: "data" },
      { from: "rest", to: "runs", kind: "data" },
      { from: "rest", to: "projects", kind: "data" },
      { from: "cron", to: "rest", kind: "optional" },
      { from: "session", to: "improver", kind: "optional" },
      { from: "improver", to: "memory", kind: "data" }
    ],

    flow: [
      {
        step: 1,
        fromId: "tui",
        toId: "wss",
        label: "user sends message over WebSocket",
        narrative:
          "A client — here the Go/Bubble Tea TUI — opens a WebSocket to ws:7337 and sends the user's message as a ClientMessage frame."
      },
      {
        step: 2,
        fromId: "wss",
        toId: "session",
        label: "server authenticates and routes to the per-connection Session",
        narrative:
          "The server checks Bearer auth (when HARNESS_API_KEY is set) and routes the frame to the Session that owns this connection."
      },
      {
        step: 3,
        fromId: "session",
        toId: "loop",
        label: "Session hands the user message to the Agent Loop",
        narrative:
          "The Session appends the message to its history and invokes the Agent Loop to produce the next assistant turn."
      },
      {
        step: 4,
        fromId: "loop",
        toId: "provider",
        label: "loop streams the conversation to the Provider Client",
        narrative:
          "The loop assembles the system prompt, tools, and history and hands them to the Provider Client for a streaming completion."
      },
      {
        step: 5,
        fromId: "provider",
        toId: "llm",
        label: "request goes to the LLM API (with retry/backoff on transient errors)",
        narrative:
          "The Provider Client calls the OpenAI-compatible LLM API, retrying with exponential backoff on 429s, 5xx, and dropped connections."
      },
      {
        step: 6,
        fromId: "llm",
        toId: "loop",
        label: "LLM streams back text and tool calls",
        narrative:
          "The model streams tokens back; the loop relays assistant text to the client and collects any requested tool calls."
      },
      {
        step: 7,
        fromId: "loop",
        toId: "registry",
        label: "loop dispatches tool calls to the Tool Registry",
        narrative:
          "For each tool call, the loop looks up the handler in the Tool Registry — a built-in, an MCP tool, or a sub-agent delegation."
      },
      {
        step: 8,
        fromId: "registry",
        toId: "acl",
        label: "each call is checked against the profile ACL (allow/prompt/deny)",
        narrative:
          "Before anything runs, the ACL resolves the call to allow, prompt, or deny based on the active profile's policy."
      },
      {
        step: 9,
        fromId: "acl",
        toId: "builtins",
        label: "approved tools execute (with pre/post hooks); results return to the loop",
        narrative:
          "Approved tools run — wrapped by pre_tool and post_tool hooks — and their results are fed back into the loop, which may call the model again."
      },
      {
        step: 10,
        fromId: "loop",
        toId: "session",
        label: "final assistant message is stored; telemetry + usage recorded",
        narrative:
          "When the model finishes, the final assistant message is stored on the Session and persisted, while telemetry and token usage are recorded."
      }
    ]
  };
})();
