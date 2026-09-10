import type {
  ApprovalMode,
  CommandSummary,
  ModelInfo,
  PendingInput,
  ProfileInfo,
  Project,
  ServerMessage,
  SessionSummary,
  SkillSummary,
  SurfaceSpec,
  Stage,
  TodoItem,
  UndoEntry,
  Intensity,
  Tier,
  SessionRuntimeWire,
  MissionWire,
  ChallengeWire,
  UsageMetadataWire,
} from './protocol'
import type { Artifact, ExecutionResult, InputRequestKind, UIMessage, WorkspaceTab } from './types'

export interface StageView {
  stage: Stage
  intensity: Intensity
  tier: Tier
  model: string
  state: 'start' | 'done' | 'escalated' | 'skipped'
  costUsd?: number
}

export interface NoticeView {
  level: 'info' | 'warn' | 'error'
  message: string
  detail?: string
}

export interface RunLane {
  messages: UIMessage[]
  stages: StageView[]
  stats?: { tokensIn: number; tokensOut: number; costUsd: number }
  status?: 'running' | 'done' | 'error' | 'budget_exceeded' | 'cancelled' | 'failed'
}

export interface SurfaceEntry { surface: SurfaceSpec; runId?: string }

export function mergeSurface(entries: SurfaceEntry[], surface: SurfaceSpec, runId?: string): SurfaceEntry[] {
  const index = entries.findIndex(entry => entry.surface.id === surface.id)
  if (index < 0) return [...entries, { surface, runId }]
  const next = [...entries]
  next[index] = { surface: surface.mode === 'patch' ? { ...next[index].surface, ...surface } : surface, runId: runId ?? next[index].runId }
  return next
}

export interface State {
  messages: UIMessage[]
  tabs: WorkspaceTab[]
  activeTab: number
  input: string
  busy: boolean
  sendError?: string
  focusPane: 'conv' | 'work'
  paletteOpen: boolean
  tokens: { in: number; out: number }
  pendingApproval: { id: string; name: string; input: unknown; risk?: 'safe' | 'caution' | 'danger'; reason?: string; preview?: unknown } | null
  approvalQueue?: { id: string; name: string; input: unknown; risk?: 'safe' | 'caution' | 'danger'; reason?: string; preview?: unknown }[]
  tweaksOpen: boolean
  theme: string
  palette: string
  density: string
  todos: TodoItem[]
  profile: string
  sessionId: string
  pendingInputRequest: { id: string; prompt: string; kind: InputRequestKind; options?: string[] } | null
  pendingCodeExecution: { id: string; code: string; language: string; data?: Record<string, unknown> } | null
  activeProject: string
  activeProjectName: string
  projects: Project[]
  history: SessionSummary[]
  runs?: Record<string, RunLane>
  activeRunId?: string
  costUsd?: number
  usage?: UsageMetadataWire
  providerStatus?: { auth: 'api_key' | 'codex_oauth'; status: string }
  budget?: { cost: number; limit?: number }
  context?: { tokens: number; window?: number }
  stages?: StageView[]
  notices?: NoticeView[]
  models?: ModelInfo[]
  currentModel?: string
  profiles?: ProfileInfo[]
  allowedPackages?: string[]
  approvalMode?: ApprovalMode
  skills?: { proposed: SkillSummary[]; installed: SkillSummary[] }
  skillContent?: { name: string; source: string; path: string; content: string }
  skillResults?: { action: 'saved' | 'promoted' | 'discarded'; name: string; path?: string }[]
  commands?: CommandSummary[]
  pending?: PendingInput[]
  undoEntries?: UndoEntry[]
  executions?: { code?: string; result: ExecutionResult }[]
  plan?: string
  surfaces?: SurfaceEntry[]
  runtime?: SessionRuntimeWire
  mission?: MissionWire
  missionReceipts?: unknown[]
  receipt?: unknown
  challenges?: ChallengeWire[]
}

export type Action =
  | { type: 'INPUT'; payload: string }
  | { type: 'USER_MSG'; payload: string }
  | { type: 'SEND_FAILED'; reason: string }
  | { type: 'SERVER_MSG'; payload: ServerMessage }
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'TOGGLE_TWEAKS' }
  | { type: 'SET_TAB'; payload: number }
  | { type: 'TOGGLE_FOCUS' }
  | { type: 'CLEAR' }
  | { type: 'RESOLVE_APPROVAL' }
  | { type: 'SET_THEME'; theme: string; palette: string; density: string }
  | { type: 'INPUT_REQUEST'; payload: { id: string; prompt: string; kind: InputRequestKind; options?: string[] } }
  | { type: 'RESOLVE_INPUT_REQUEST' }
  | { type: 'SET_TODOS'; payload: TodoItem[] }
  | { type: 'RESOLVE_CODE_EXECUTION' }
  | { type: 'SET_ACTIVE_PROJECT'; id: string; name: string }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'SET_HISTORY'; payload: SessionSummary[] }
  | { type: 'HYDRATE_MESSAGES'; payload: { messages: UIMessage[]; prepend: boolean } }
  | { type: 'RECORD_EXECUTION'; payload: { code?: string; result: ExecutionResult } }

export const initialState: State = {
  messages: [], tabs: [], activeTab: 0, input: '', busy: false,
  focusPane: 'conv', paletteOpen: false, tokens: { in: 0, out: 0 },
  pendingApproval: null, tweaksOpen: false, theme: 'dark', palette: 'amber', density: 'regular',
  todos: [], pendingInputRequest: null, pendingCodeExecution: null,
  profile: '…', sessionId: '…',
  activeProject: 'inbox', activeProjectName: 'Inbox', projects: [], history: [],
}

const id = () => Math.random().toString(36).slice(2)

function lane(state: State, runId: string): RunLane {
  return state.runs?.[runId] ?? { messages: [], stages: [] }
}

function withLane(state: State, runId: string | undefined, update: (current: RunLane) => RunLane): State {
  if (!runId) return state
  const current = lane(state, runId)
  return { ...state, runs: { ...(state.runs ?? {}), [runId]: update(current) } }
}

function appendToken(messages: UIMessage[], content: string): UIMessage[] {
  const last = messages.at(-1)
  if (last?.role === 'agent') return [...messages.slice(0, -1), { ...last, content: `${last.content ?? ''}${content}` }]
  return [...messages, { id: id(), role: 'agent', content }]
}

function applyMessageToLane(state: State, runId: string | undefined, update: (messages: UIMessage[]) => UIMessage[]): State {
  if (!runId) return { ...state, messages: update(state.messages) }
  const next = withLane(state, runId, current => ({ ...current, messages: update(current.messages) }))
  return runId === state.activeRunId ? { ...next, messages: update(state.messages) } : next
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INPUT': return { ...state, input: action.payload, sendError: undefined }
    case 'USER_MSG': return { ...state, input: '', busy: true, sendError: undefined, messages: [...state.messages, { id: id(), role: 'user', content: action.payload }] }
    // A frame the transport refused must never look sent: keep the composed
    // text and stay idle so the operator can retry.
    case 'SEND_FAILED': return { ...state, sendError: action.reason }
    case 'TOGGLE_PALETTE': return { ...state, paletteOpen: !state.paletteOpen }
    case 'TOGGLE_TWEAKS': return { ...state, tweaksOpen: !state.tweaksOpen }
    case 'SET_TAB': return { ...state, activeTab: action.payload }
    case 'TOGGLE_FOCUS': return { ...state, focusPane: state.focusPane === 'conv' ? 'work' : 'conv' }
    case 'CLEAR': return { ...state, messages: [], tabs: [], busy: false, pendingApproval: null, approvalQueue: [] }
    case 'RESOLVE_APPROVAL': { const queue = [...(state.approvalQueue ?? [])].slice(1); return { ...state, approvalQueue: queue, pendingApproval: queue[0] ?? null } }
    case 'SET_THEME': return { ...state, theme: action.theme, palette: action.palette, density: action.density }
    case 'INPUT_REQUEST': return { ...state, pendingInputRequest: action.payload }
    case 'RESOLVE_INPUT_REQUEST': return { ...state, pendingInputRequest: null }
    case 'SET_TODOS': return { ...state, todos: action.payload }
    case 'RESOLVE_CODE_EXECUTION': return { ...state, pendingCodeExecution: null }
    case 'SET_ACTIVE_PROJECT': return { ...state, activeProject: action.id, activeProjectName: action.name }
    case 'SET_PROJECTS': return { ...state, projects: action.payload }
    case 'SET_HISTORY': return { ...state, history: action.payload }
    case 'HYDRATE_MESSAGES': return { ...state, messages: action.payload.prepend || state.messages.length ? [...action.payload.messages, ...state.messages] : action.payload.messages }
    case 'RECORD_EXECUTION': return { ...state, executions: [...(state.executions ?? []), action.payload], pendingCodeExecution: null }
    case 'SERVER_MSG': {
      const msg = action.payload
      switch (msg.type) {
        case 'turn_start': {
          const current = lane(state, msg.run_id)
          return { ...state, busy: true, activeRunId: msg.run_id, runs: { ...(state.runs ?? {}), [msg.run_id]: { ...current, status: 'running' } } }
        }
        case 'token': return applyMessageToLane(state, msg.run_id, messages => appendToken(messages, msg.content))
        case 'tool_start': return applyMessageToLane(state, msg.run_id, messages => [...messages, { id: id(), role: 'tool-call', toolCallID: msg.id, name: msg.name, input: msg.input, status: 'running' }])
        case 'tool_parked': return applyMessageToLane(state, msg.run_id, messages => {
          const next = [...messages]
          const index = next.findLastIndex(item => item.role === 'tool-call' && item.toolCallID === msg.id && item.status === 'running')
          if (index >= 0) next[index] = { ...next[index], status: 'waiting', pending: true }
          return next
        })
        case 'tool_end': return applyMessageToLane(state, msg.run_id, messages => {
          const next = [...messages]
          const index = next.findLastIndex(item => item.role === 'tool-call' && item.toolCallID === msg.id && (item.status === 'running' || item.status === 'waiting'))
          if (index >= 0) next[index] = { ...next[index], status: msg.ok === false ? 'error' : 'done', pending: false, result: msg.result }
          return next
        })
        case 'tool_prompt': { const item = { id: msg.id, name: msg.name, input: msg.input, risk: msg.risk, reason: msg.reason, preview: msg.preview }; const queue = [...(state.approvalQueue ?? []), item]; return { ...state, approvalQueue: queue, pendingApproval: state.pendingApproval ?? item } }
        case 'tool_auto_approved': return { ...state, notices: [...(state.notices ?? []), { level: 'info', message: msg.name + ' auto-approved · scope: ' + msg.scope }] }
        case 'input_request': return { ...state, pendingInputRequest: { id: msg.id, prompt: msg.prompt, kind: msg.kind, options: msg.options } }
        case 'todos': return { ...state, todos: msg.todos }
        case 'session_ready': return { ...state, profile: msg.profile, sessionId: msg.sessionId, currentModel: msg.model, allowedPackages: msg.allowed_packages ?? [], providerStatus: msg.provider_status, budget: msg.budget ? { cost: state.costUsd ?? 0, limit: msg.budget.max_cost_usd } : undefined, approvalMode: state.approvalMode }
        case 'stats': {
          const next = { ...state, tokens: { in: msg.tokens_in, out: msg.tokens_out }, costUsd: msg.cost_usd, usage: msg.usage ?? state.usage, budget: state.budget ? { ...state.budget, cost: msg.cost_usd } : undefined, context: { tokens: msg.context_tokens ?? state.context?.tokens ?? 0, window: msg.context_window ?? state.context?.window } }
          return withLane(next, msg.run_id, current => ({ ...current, stats: { tokensIn: msg.tokens_in, tokensOut: msg.tokens_out, costUsd: msg.cost_usd } }))
        }
        case 'session_end': {
          const status = msg.status === 'budget_exceeded' || msg.status === 'cancelled' || msg.status === 'failed' ? msg.status : 'done'
          return withLane({ ...state, busy: false }, msg.run_id, current => ({ ...current, status }))
        }
        // Resume can switch profiles server-side, so adopt the reported profile too.
        case 'session_resumed': return { ...state, busy: false, sessionId: msg.sessionId, profile: msg.profile }
        case 'error': return withLane({ ...state, busy: false, notices: [...(state.notices ?? []), { level: 'error', message: msg.message }] }, msg.run_id, current => ({ ...current, status: 'error' }))
        case 'code_execute': return { ...state, pendingCodeExecution: { id: msg.id, code: msg.code, language: msg.language, data: msg.data } }
        case 'artifacts': {
          const tab: WorkspaceTab = { id: id(), label: 'Artifacts', icon: '✦', artifacts: msg.artifacts as Artifact[] }
          return { ...state, tabs: [...state.tabs, tab], activeTab: state.tabs.length }
        }
        case 'ui_render': return { ...state, surfaces: mergeSurface(state.surfaces ?? [], msg.surface, msg.run_id) }
        case 'runtime': return { ...state, runtime: msg.snapshot }
        case 'mission': return { ...state, mission: msg.mission, missionReceipts: msg.receipts }
        case 'receipt': return { ...state, receipt: msg.receipt }
        case 'challenge': return { ...state, challenges: [...(state.challenges ?? []).filter(item => item.id !== msg.challenge.id), msg.challenge] }
        case 'projects': return { ...state, projects: msg.projects }
        case 'project_created': return { ...state, projects: [...state.projects, msg.project], activeProject: msg.project.id, activeProjectName: msg.project.name }
        case 'sessions': return { ...state, history: msg.sessions }
        case 'models': return { ...state, models: msg.models, currentModel: msg.current }
        case 'model_changed': return { ...state, currentModel: msg.model }
        case 'profiles': return { ...state, profiles: msg.profiles, profile: msg.current }
        case 'approval_mode_changed': return { ...state, approvalMode: msg.mode }
        case 'skills': return { ...state, skills: { proposed: msg.proposed, installed: msg.installed } }
        case 'commands': return { ...state, commands: msg.commands }
        case 'skill_content': return { ...state, skillContent: msg }
        case 'skill_result': return { ...state, skillResults: [...(state.skillResults ?? []), msg] }
        case 'notice': return { ...state, notices: [...(state.notices ?? []), { level: msg.level, message: msg.message, detail: msg.detail }] }
        case 'stage': {
          const view: StageView = { stage: msg.stage, intensity: msg.intensity, tier: msg.tier, model: msg.model, state: msg.state, costUsd: msg.cost_usd }
          const next = { ...state, stages: [...(state.stages ?? []), view] }
          return withLane(next, msg.run_id, current => ({ ...current, stages: [...current.stages, view] }))
        }
        case 'plan': return { ...state, plan: msg.content }
        case 'pending': return { ...state, pending: msg.pending }
        case 'undo_entries': return { ...state, undoEntries: msg.entries }
        case 'transcript_partial':
        case 'audio_out_start':
        case 'audio_out_end':
          // Deferred to ambient audio/transcript track; retain protocol parity without mutating UI state.
          return state
        default: {
          return state
        }
      }
    }
    default: return state
  }
}

export type { ExecutionResult }
