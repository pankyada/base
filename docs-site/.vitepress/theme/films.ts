// Architecture model + scene scripts for the use-case films
// (docs-site/how-it-works.md). Pure data — no rendering or timing logic lives
// outside this file.
//
// Node ids are deliberately the SAME ids the interactive architecture explorer
// uses (docs/architecture-site/data.js), so the two surfaces share one
// vocabulary: the explorer is the map, these films are the narrative through
// it. See docs/ADR.md ADR-73/74.
//
// tests/use-case-films.test.ts asserts every Beat.source path still exists, so
// a refactor that moves a module turns a stale film into a CI failure.

/* ------------------------------------------------------------------ *
 * Architecture model
 * ------------------------------------------------------------------ */

export type ZoneId = 'client' | 'edge' | 'server' | 'external'
export type GroupId =
  | 'clients' | 'transport'
  | 'routing' | 'core' | 'safety' | 'tools' | 'memory' | 'automation' | 'state'
  | 'external'

export interface ArchGroup {
  id: GroupId
  label: string
  zone: ZoneId
  accent: string
}

export interface ArchNode {
  id: string
  /** 1–2 short lines — SVG text does not wrap. */
  lines: string[]
  group: GroupId
}

/** Accents mirror the explorer's layer palette. */
export const ARCH_GROUPS: ArchGroup[] = [
  { id: 'clients', label: 'Clients', zone: 'client', accent: '#2563eb' },
  { id: 'transport', label: 'Transport', zone: 'edge', accent: '#2563eb' },
  { id: 'routing', label: 'Routing', zone: 'server', accent: '#2563eb' },
  { id: 'core', label: 'Core loop', zone: 'server', accent: '#059669' },
  { id: 'safety', label: 'Safety', zone: 'server', accent: '#dc2626' },
  { id: 'tools', label: 'Tools', zone: 'server', accent: '#059669' },
  { id: 'memory', label: 'Memory', zone: 'server', accent: '#b45309' },
  { id: 'automation', label: 'Automation', zone: 'server', accent: '#b45309' },
  { id: 'state', label: 'State', zone: 'server', accent: '#b45309' },
  { id: 'external', label: 'External', zone: 'external', accent: '#7c3aed' },
]

export const ARCH_NODES: ArchNode[] = [
  // clients
  { id: 'tui', lines: ['Go TUI'], group: 'clients' },
  { id: 'cli', lines: ['CLI'], group: 'clients' },
  { id: 'web', lines: ['Web app'], group: 'clients' },
  // transport boundary
  { id: 'wss', lines: ['WS', ':7337'], group: 'transport' },
  { id: 'rest', lines: ['REST', '/run'], group: 'transport' },
  // server — routing
  { id: 'registry', lines: ['Profile', 'registry'], group: 'routing' },
  { id: 'session', lines: ['Session'], group: 'routing' },
  // server — core loop
  { id: 'workflow', lines: ['Workflow', 'router'], group: 'core' },
  { id: 'loop', lines: ['Agent loop'], group: 'core' },
  { id: 'ctx', lines: ['Context', 'projection'], group: 'core' },
  { id: 'provider', lines: ['Provider', 'client'], group: 'core' },
  // server — safety
  { id: 'acl', lines: ['Conditional', 'ACL'], group: 'safety' },
  { id: 'provenance', lines: ['Provenance', 'gate'], group: 'safety' },
  { id: 'budget', lines: ['Autonomy', 'budget'], group: 'safety' },
  { id: 'hooks', lines: ['Hooks', 'runner'], group: 'safety' },
  { id: 'audit', lines: ['Audit', '+ undo'], group: 'safety' },
  // server — tools
  { id: 'toolreg', lines: ['Tool', 'registry'], group: 'tools' },
  { id: 'builtins', lines: ['Built-ins'], group: 'tools' },
  { id: 'executor', lines: ['Executor'], group: 'tools' },
  { id: 'mcp', lines: ['MCP client'], group: 'tools' },
  // server — memory
  { id: 'fsmem', lines: ['FS memory'], group: 'memory' },
  { id: 'temporal', lines: ['Temporal', '+ Recall'], group: 'memory' },
  // server — automation
  { id: 'triggers', lines: ['Triggers'], group: 'automation' },
  { id: 'pending', lines: ['Deferred', 'asks'], group: 'automation' },
  { id: 'channels', lines: ['Channels'], group: 'automation' },
  // server — state
  { id: 'sessions', lines: ['Session', 'store'], group: 'state' },
  { id: 'telemetry', lines: ['Telemetry'], group: 'state' },
  // external
  { id: 'llm', lines: ['LLM API'], group: 'external' },
  { id: 'mcpservers', lines: ['MCP', 'servers'], group: 'external' },
  { id: 'endpoints', lines: ['Channel', 'endpoints'], group: 'external' },
]

export const NODE_BY_ID: Record<string, ArchNode> =
  Object.fromEntries(ARCH_NODES.map(n => [n.id, n]))

/* ------------------------------------------------------------------ *
 * Layout — deterministic geometry, computed once, consumed by the SFC.
 * ------------------------------------------------------------------ */

export const STAGE = { width: 1120, height: 620 }

const ZONE_X: Record<ZoneId, { x: number; w: number }> = {
  client: { x: 14, w: 106 },
  edge: { x: 156, w: 84 },
  server: { x: 276, w: 600 },
  external: { x: 918, w: 188 },
}

/** Server container box. */
export const SERVER_BOX = { x: ZONE_X.server.x, y: 34, w: ZONE_X.server.w, h: 566 }

const SERVER_BANDS: { group: GroupId; y: number }[] = [
  { group: 'routing', y: 64 },
  { group: 'core', y: 140 },
  { group: 'safety', y: 216 },
  { group: 'tools', y: 292 },
  { group: 'memory', y: 368 },
  { group: 'automation', y: 444 },
  { group: 'state', y: 520 },
]
const BAND_H = 64
const BAND_LABEL_W = 74
const NODE_H = 40
const NODE_GAP = 8
const NODE_MAX_W = 108

export interface Rect { x: number; y: number; w: number; h: number }
export interface PlacedNode extends Rect { id: string; lines: string[]; group: GroupId }
export interface PlacedBand extends Rect { group: GroupId; label: string; accent: string }

function stackZone(zone: ZoneId, ids: string[], startY: number, gap: number, h: number): PlacedNode[] {
  const { x, w } = ZONE_X[zone]
  return ids.map((id, i) => ({
    id, lines: NODE_BY_ID[id].lines, group: NODE_BY_ID[id].group,
    x, y: startY + i * (h + gap), w, h,
  }))
}

function layout(): { nodes: PlacedNode[]; bands: PlacedBand[] } {
  const nodes: PlacedNode[] = []
  const bands: PlacedBand[] = []

  nodes.push(...stackZone('client', ['tui', 'cli', 'web'], 120, 14, 46))
  nodes.push(...stackZone('edge', ['wss', 'rest'], 140, 22, 56))
  nodes.push(...stackZone('external', ['llm', 'mcpservers', 'endpoints'], 150, 16, 54))

  for (const band of SERVER_BANDS) {
    const group = ARCH_GROUPS.find(g => g.id === band.group)!
    bands.push({
      group: band.group, label: group.label, accent: group.accent,
      x: SERVER_BOX.x + 10, y: band.y, w: SERVER_BOX.w - 20, h: BAND_H,
    })
    const members = ARCH_NODES.filter(n => n.group === band.group)
    const areaX = SERVER_BOX.x + 10 + BAND_LABEL_W
    const areaW = SERVER_BOX.w - 20 - BAND_LABEL_W - 10
    const w = Math.min(NODE_MAX_W, (areaW - NODE_GAP * (members.length - 1)) / members.length)
    members.forEach((n, i) => {
      nodes.push({
        id: n.id, lines: n.lines, group: n.group,
        x: areaX + i * (w + NODE_GAP), y: band.y + (BAND_H - NODE_H) / 2, w, h: NODE_H,
      })
    })
  }
  return { nodes, bands }
}

const placed = layout()
export const PLACED_NODES: PlacedNode[] = placed.nodes
export const PLACED_BANDS: PlacedBand[] = placed.bands
export const PLACED_BY_ID: Record<string, PlacedNode> =
  Object.fromEntries(PLACED_NODES.map(n => [n.id, n]))

/* ------------------------------------------------------------------ *
 * Films
 * ------------------------------------------------------------------ */

export type Tone = 'normal' | 'gate' | 'deny' | 'halt'

export interface Beat {
  /** Stable id, used for deep links: #film-<filmId>-beat-<n>. */
  id: string
  /** Start time in ms, relative to film start. */
  t: number
  /** Duration in ms. */
  dur: number
  /** Node that lights up. */
  actor: string
  /** Optional edge target — draws an animated packet from actor to this node. */
  to?: string
  /** One sentence, present tense. */
  caption: string
  /** Optional second line, shown under the caption. */
  detail?: string
  /** Repo paths this beat depicts. Required — enforced by the citation test. */
  source: string[]
  tone?: Tone
}

export interface Film {
  id: 'coding' | 'assistant' | 'data' | 'ops'
  title: string
  premise: string
  /** Profile YAML this film runs, relative to repo root. */
  profile: string
  runtime: number
  /** Nodes this scenario touches — everything else renders ghosted. */
  cast: string[]
  beats: Beat[]
}

/** Sequential timing: each beat starts where the previous one ended. */
function sequence(raw: (Omit<Beat, 't'> & { dur: number })[]): Beat[] {
  let t = 0
  return raw.map(b => {
    const beat = { ...b, t }
    t += b.dur
    return beat
  })
}

function runtimeOf(beats: Beat[]): number {
  return beats.reduce((max, b) => Math.max(max, b.t + b.dur), 0)
}

function castOf(beats: Beat[]): string[] {
  const set = new Set<string>()
  for (const b of beats) { set.add(b.actor); if (b.to) set.add(b.to) }
  return [...set]
}

const codingBeats = sequence([
  {
    id: 'ask', dur: 1500, actor: 'tui', to: 'wss',
    caption: 'You ask the TUI to fix a failing test. It opens a WebSocket to :7337.',
    detail: 'One process serves both WS and HTTP on one port; the TUI is a thin client with no agent logic of its own.',
    source: ['tui/main.go', 'src/server/index.ts'],
  },
  {
    id: 'origin', dur: 1400, actor: 'wss',
    caption: 'The upgrade is checked against the origin allowlist before it is accepted.',
    detail: 'WebSocket upgrades get no same-origin protection from the browser, so the server checks Origin itself.',
    source: ['src/server/origin.ts'],
  },
  {
    id: 'route', dur: 1400, actor: 'wss', to: 'registry',
    caption: 'The profile registry resolves which agent owns this connection — here, coding.',
    source: ['src/profiles/schema.ts', 'profiles/coding.yaml'],
  },
  {
    id: 'session', dur: 1300, actor: 'registry', to: 'session',
    caption: 'A session is created: isolated per connection, with its own memory view.',
    source: ['src/session/store.ts'],
  },
  {
    id: 'triage', dur: 1600, actor: 'session', to: 'workflow',
    caption: 'The workflow router triages the task and sends recon to the cheap model tier.',
    detail: 'cheap → balanced → frontier → critic. Escalation is earned by observed failure, never sized up front.',
    source: ['src/workflow/', 'profiles/coding.yaml'],
  },
  {
    id: 'project', dur: 1500, actor: 'ctx', to: 'loop',
    caption: 'Context projection turns the append-only ledger into a budgeted request.',
    detail: 'Tool results elide to restorable handles; the ledger itself is never rewritten.',
    source: ['src/context/projection.ts'],
  },
  {
    id: 'call', dur: 1400, actor: 'loop', to: 'provider',
    caption: 'The loop hands the projected conversation to the provider client.',
    source: ['src/loop/agent-loop.ts'],
  },
  {
    id: 'llm', dur: 1500, actor: 'provider', to: 'llm',
    caption: 'An OpenAI-compatible call goes out, retrying with backoff on transient errors.',
    source: ['src/models/registry.ts'],
  },
  {
    id: 'stream', dur: 1400, actor: 'llm', to: 'loop',
    caption: 'Tokens stream back, along with a Bash tool call the model wants to make.',
    source: ['src/loop/agent-loop.ts'],
  },
  {
    id: 'dispatch', dur: 1300, actor: 'loop', to: 'toolreg',
    caption: 'The tool registry looks up the handler for that call.',
    source: ['src/tools/registry.ts'],
  },
  {
    id: 'acl', dur: 1500, actor: 'toolreg', to: 'acl',
    caption: 'The ACL resolves Bash to prompt — the one thing this profile always asks about.',
    source: ['src/tools/acl.ts', 'profiles/coding.yaml'],
  },
  {
    id: 'wait', dur: 2400, actor: 'acl', to: 'tui', tone: 'gate',
    caption: 'The run pauses and waits for you. Nothing executes until you approve.',
    detail: 'Shell commands are the highest-variance action a coding agent takes, so this gate is never skipped.',
    source: ['src/server/index.ts', 'src/server/approval-mode.ts'],
  },
  {
    id: 'exec', dur: 1500, actor: 'builtins', to: 'hooks',
    caption: 'Approved: the command runs, wrapped by pre_tool and post_tool hooks.',
    source: ['src/tools/builtin/', 'src/hooks/runner.ts'],
  },
  {
    id: 'audit', dur: 1400, actor: 'hooks', to: 'audit',
    caption: 'The call, its arguments, and why it was allowed land in the audit journal.',
    source: ['src/audit/'],
  },
  {
    id: 'persist', dur: 1500, actor: 'audit', to: 'sessions',
    caption: 'Session, usage, and telemetry persist under ~/.harness. The fix is yours to review.',
    source: ['src/session/store.ts', 'src/telemetry/logger.ts'],
  },
])

const opsBeats = sequence([
  {
    id: 'idle', dur: 2400, actor: 'triggers',
    caption: 'The watch trigger polls the error log. Nothing changed — and nothing happens.',
    detail: 'No model call, no session, no cost. The free no-change path is the whole economic claim of triggers.',
    source: ['src/triggers/manager.ts'],
  },
  {
    id: 'fire', dur: 1600, actor: 'triggers', to: 'registry',
    caption: 'Errors spike. After a 5s debounce the batch fires a real run — nobody is watching.',
    source: ['src/triggers/manager.ts', 'profiles/devops.yaml'],
  },
  {
    id: 'session', dur: 1300, actor: 'registry', to: 'session',
    caption: 'The devops profile starts an unattended session in production mode.',
    source: ['profiles/devops.yaml'],
  },
  {
    id: 'budget-open', dur: 1400, actor: 'session', to: 'budget',
    caption: 'A budget opens on the run: $1.00, 40 tools, 300 seconds.',
    detail: 'Checked before every model call and every tool call, not tallied afterwards.',
    source: ['src/runs/budget.ts', 'profiles/devops.yaml'],
  },
  {
    id: 'loop', dur: 1400, actor: 'loop', to: 'toolreg',
    caption: 'The agent reads logs and memory pressure, then goes looking for open PRs.',
    source: ['src/loop/agent-loop.ts'],
  },
  {
    id: 'mcp', dur: 1600, actor: 'mcp', to: 'mcpservers',
    caption: 'list_pull_requests is allowed on the GitHub MCP server; everything else on it still prompts.',
    detail: 'MCP tools are namespaced serverName__toolName and carry the server’s own ACL.',
    source: ['src/mcp/client.ts', 'profiles/devops.yaml'],
  },
  {
    id: 'notify', dur: 1900, actor: 'acl', to: 'channels', tone: 'gate',
    caption: 'Notify passes a conditional ACL — allowed only because the channel is in trusted_channels.',
    detail: 'allow_if: { arg: channel, in_list: trusted_channels } — a closed, data-only predicate. No code eval, and deny always wins.',
    source: ['src/tools/acl.ts', 'profiles/devops.yaml'],
  },
  {
    id: 'page', dur: 1500, actor: 'channels', to: 'endpoints',
    caption: 'oncall is paged. No other endpoint could have been reached this way.',
    source: ['src/channels/runtime.ts'],
  },
  {
    id: 'climb', dur: 1700, actor: 'budget',
    caption: 'A flaky check keeps retrying. Spend climbs toward the ceiling at 3am.',
    source: ['src/runs/budget.ts'],
  },
  {
    id: 'halt', dur: 2200, actor: 'budget', to: 'channels', tone: 'halt',
    caption: 'Budget exceeded: cost. The run aborts — a spend ceiling, not a policy refusal.',
    detail: 'BudgetExceeded names the real reason (cost / tools / wall). Partial output is preserved and oncall is told what was in flight.',
    source: ['src/runs/budget.ts', 'src/runs/types.ts'],
  },
  {
    id: 'audit', dur: 1600, actor: 'audit',
    caption: 'Every effectful call is in the journal with why it was allowed — and most can be undone.',
    source: ['src/audit/', 'src/server/undo-handlers.ts'],
  },
])

const assistantBeats = sequence([
  {
    id: 'speak', dur: 1600, actor: 'tui', to: 'wss',
    caption: 'You speak. Streaming STT transcribes; endpointing waits for real silence.',
    source: ['profiles/assistant.yaml'],
  },
  {
    id: 'mode', dur: 1600, actor: 'registry', to: 'acl',
    caption: 'mode: assistant applies a tight posture — no shell, no code execution, ever.',
    detail: 'Mode defaults always win over profile-level overrides; they can only tighten, never widen.',
    source: ['src/profiles/schema.ts', 'profiles/assistant.yaml'],
  },
  {
    id: 'ask', dur: 1800, actor: 'builtins', to: 'pending', tone: 'gate',
    caption: 'AskUser({ defer: true, ttl: "12h" }) parks the question — written to disk, not held in memory.',
    source: ['src/tools/builtin/'],
  },
  {
    id: 'restart', dur: 2000, actor: 'pending', tone: 'halt',
    caption: 'The connection drops. The server restarts. The question is still there.',
    detail: 'A deferred ask that dies with its connection was never deferred. This one is a file, so it survives.',
    source: ['src/server/index.ts', 'src/runs/types.ts'],
  },
  {
    id: 'inbound', dur: 1700, actor: 'endpoints', to: 'channels',
    caption: 'Hours later an answer arrives on the paired phone channel.',
    detail: 'inbound: paired — only you can answer. Anyone else who finds the webhook URL is inert.',
    source: ['src/channels/runtime.ts', 'profiles/assistant.yaml'],
  },
  {
    id: 'resume', dur: 1600, actor: 'channels', to: 'pending',
    caption: 'The pending store matches the answer to its parked run and resumes it.',
    source: ['src/server/undo-handlers.ts'],
  },
  {
    id: 'recall', dur: 1900, actor: 'temporal', to: 'fsmem',
    caption: 'Recall answers "what was true then" — facts carry validity intervals, not eternal truth.',
    detail: 'Supersession collapses the view without collapsing the history, so the old belief is still auditable.',
    source: ['src/memory/fs-memory.ts', 'docs-site/memory.md'],
  },
  {
    id: 'reply', dur: 1600, actor: 'loop', to: 'channels',
    caption: 'The assistant answers back on the same channel it was asked on.',
    source: ['src/channels/runtime.ts'],
  },
])

const dataBeats = sequence([
  {
    id: 'post', dur: 1500, actor: 'web', to: 'rest',
    caption: 'Another service — not a human — POSTs to /run with a dataset path and a question.',
    source: ['src/server/rest.ts'],
  },
  {
    id: 'reject', dur: 2000, actor: 'rest', tone: 'halt',
    caption: 'A malformed call is missing "question". The contract returns 422 with a reason.',
    detail: 'Fails loudly instead of letting the model guess at missing fields.',
    source: ['src/profiles/schema.ts', 'profiles/data.yaml'],
  },
  {
    id: 'accept', dur: 1400, actor: 'rest', to: 'session',
    caption: 'A well-formed call validates against the same contract and starts a session.',
    source: ['src/server/rest.ts'],
  },
  {
    id: 'budget', dur: 1400, actor: 'session', to: 'budget',
    caption: 'A budget bounds the run — a caller stuck in a retry loop cannot run up a bill.',
    source: ['src/runs/budget.ts'],
  },
  {
    id: 'read', dur: 1600, actor: 'loop', to: 'builtins',
    caption: 'Read, Grep, and Glob examine the dataset. Those are the only tools it has.',
    source: ['profiles/data.yaml'],
  },
  {
    id: 'deny', dur: 2200, actor: 'acl', tone: 'deny',
    caption: 'The model tries Bash to reshape the CSV. Bash: deny — refused, with no prompt offered.',
    detail: 'deny is absolute: no mode, no argument, and no yolo flag can widen it. There is also nobody here to prompt.',
    source: ['src/tools/acl.ts', 'profiles/data.yaml'],
  },
  {
    id: 'answer', dur: 1600, actor: 'loop', to: 'rest',
    caption: 'The typed result — answer plus confidence — returns in the shape the contract declared.',
    source: ['src/profiles/schema.ts'],
  },
])

export const films: Film[] = [
  {
    id: 'coding',
    title: 'Coding assistant',
    premise: 'A developer in the loop the whole time. Follow one request from the TUI, through the transport boundary, down the agent loop, out to the model, and back through the approval gate before anything touches the shell.',
    profile: 'profiles/coding.yaml',
    runtime: runtimeOf(codingBeats),
    cast: castOf(codingBeats),
    beats: codingBeats,
  },
  {
    id: 'assistant',
    title: 'Personal assistant with voice',
    premise: 'A private assistant you talk to. Watch a question get parked to disk, survive a full server restart, and come back hours later through a paired channel.',
    profile: 'profiles/assistant.yaml',
    runtime: runtimeOf(assistantBeats),
    cast: castOf(assistantBeats),
    beats: assistantBeats,
  },
  {
    id: 'data',
    title: 'Production data-analysis agent',
    premise: 'Called by code over REST, not by a person. A bad request gets a 422 rather than a guess, and a denied tool stays denied because there is nobody present to ask.',
    profile: 'profiles/data.yaml',
    runtime: runtimeOf(dataBeats),
    cast: castOf(dataBeats),
    beats: dataBeats,
  },
  {
    id: 'ops',
    title: 'Unattended ops agent',
    premise: 'Nobody is watching. The watcher does nothing at all until something actually changes — then one run pages oncall through a conditional ACL and halts itself on a spend ceiling.',
    profile: 'profiles/devops.yaml',
    runtime: runtimeOf(opsBeats),
    cast: castOf(opsBeats),
    beats: opsBeats,
  },
]

export function filmById(id: string): Film | undefined {
  return films.find(f => f.id === id)
}
