import type { ServerMessage, SkillSummary, UndoEntry, RiskLevel } from './protocol'

export interface OperatorApproval { id: string; name: string; input: unknown; risk?: RiskLevel; reason?: string; requestId?: string; sentAt?: number; error?: string }
export interface OperatorState {
  sessionId?: string
  profile?: string
  approvals: Record<string, OperatorApproval>
  budget?: { cost: number; limit?: number }
  skills?: { proposed: SkillSummary[]; installed: SkillSummary[] }
  content: Record<string, string>
  undoEntries: UndoEntry[]
  recoveryError?: string
  answers: Record<string, { requestId?: string; sentAt?: number; error?: string }>
  revision: number
}
export const initialOperatorState = (): OperatorState => ({ approvals: {}, content: {}, undoEntries: [], answers: {}, revision: -1 })
export type OperatorAction = { type: 'answer'; id: string; requestId: string } | { type: 'answer_failed'; id: string; requestId: string; error: string } | { type: 'message'; payload: ServerMessage } | { type: 'reset' } | { type: 'disconnected' } | { type: 'decision'; id: string; requestId: string } | { type: 'decision_failed'; id: string; requestId: string; error: string }
const remove = (state: OperatorState, id: string): OperatorState => { const approvals = { ...state.approvals }; delete approvals[id]; return { ...state, approvals } }
export function operatorReducer(state: OperatorState, action: OperatorAction): OperatorState {
  if (action.type === 'reset') return initialOperatorState()
  if (action.type === 'disconnected') return { ...state, approvals: {}, answers: Object.fromEntries(Object.keys(state.answers).map(id => [id, { error: 'Connection lost; refreshing recorded answer state.' }])), recoveryError: Object.keys(state.approvals).length ? 'Tool approvals interrupted by disconnect; server callbacks cannot be resumed.' : state.recoveryError }
  if (action.type === 'answer') return { ...state, answers: { ...state.answers, [action.id]: { requestId: action.requestId, sentAt: Date.now() } } }
  if (action.type === 'answer_failed') return state.answers[action.id]?.requestId === action.requestId ? { ...state, answers: { ...state.answers, [action.id]: { error: action.error } } } : state
  if (action.type === 'decision') {
    const item = state.approvals[action.id]
    return item ? { ...state, approvals: { ...state.approvals, [action.id]: { ...item, requestId: action.requestId, sentAt: Date.now(), error: undefined } } } : state
  }
  if (action.type === 'decision_failed') {
    const item = state.approvals[action.id]
    return item?.requestId === action.requestId ? { ...state, approvals: { ...state.approvals, [action.id]: { ...item, requestId: undefined, error: action.error } } } : state
  }
  const msg = action.payload
  switch (msg.type) {
    case 'session_ready': case 'session_resumed': {
      const next = state.sessionId === msg.sessionId ? state : { ...initialOperatorState(), recoveryError: state.recoveryError }
      return { ...next, sessionId: msg.sessionId, profile: msg.profile, ...(msg.type === 'session_ready' && msg.budget ? { budget: { cost: 0, limit: msg.budget.max_cost_usd } } : {}) }
    }
    case 'profiles': return { ...state, profile: msg.current }
    case 'tool_prompt': {
      if (!state.approvals[msg.id] && Object.keys(state.approvals).length >= 256) return { ...state, recoveryError: 'Additional approval details unavailable: retention limit reached.' }
      return { ...state, approvals: { ...state.approvals, [msg.id]: { ...msg, ...state.approvals[msg.id] } } }
    }
    case 'tool_end': return remove(state, msg.id)
    case 'session_end': return msg.agent_id ? state : { ...state, approvals: {} }
    case 'stats': return msg.agent_id ? state : { ...state, budget: { ...state.budget, cost: msg.cost_usd } }
    case 'skills': return { ...state, skills: { proposed: msg.proposed, installed: msg.installed } }
    case 'skill_content': return { ...state, content: { ...state.content, [msg.name]: msg.content } }
    case 'pending_result': {
      const item = state.answers[msg.pending_id]
      if (!item || item.requestId !== msg.request_id) return state
      const answers = { ...state.answers }
      if (msg.status === 'answered') delete answers[msg.pending_id]
      else answers[msg.pending_id] = { error: msg.error ?? 'Answer not accepted; refresh pending state.' }
      return { ...state, answers }
    }
    case 'pending': {
      const open = new Set(msg.pending.filter(item => item.state === 'open').map(item => item.id))
      return { ...state, answers: Object.fromEntries(Object.entries(state.answers).filter(([id]) => open.has(id))) }
    }
    case 'undo_entries': return { ...state, undoEntries: msg.entries }
    case 'notice': case 'error': {
      if (!msg.request_id) return state
      const item = Object.values(state.approvals).find(value => value.requestId === msg.request_id)
      if (!item) {
        const answer = Object.entries(state.answers).find(([, value]) => value.requestId === msg.request_id)
        return answer && (msg.type === 'error' || msg.level === 'error') ? operatorReducer(state, { type: 'answer_failed', id: answer[0], requestId: msg.request_id, error: msg.message }) : state
      }
      if (msg.type === 'error' || msg.level === 'error') return operatorReducer(state, { type: 'decision_failed', id: item.id, requestId: msg.request_id, error: msg.message })
      return msg.message === 'decision accepted' ? remove(state, item.id) : state
    }
    case 'runtime': {
      const snapshot = msg.snapshot
      if (snapshot.session_id !== state.sessionId || snapshot.revision <= state.revision) return state
      let next = state
      // Prefer the server-owned actionable projection. Event tail replay is
      // fallback for older servers and never manufactures controls from IDs.
      const actionable = new Set(snapshot.actionable_ids ?? [])
      for (const prompt of snapshot.actionable ?? []) {
        if (!actionable.has(prompt.id)) continue
        next = operatorReducer(next, { type: 'message', payload: { ...prompt, type: 'tool_prompt' } })
      }
      for (const event of snapshot.events) {
        if (event.type !== 'tool_prompt' || !event.payload || typeof event.payload !== 'object') continue
        const prompt = event.payload as Extract<ServerMessage, { type: 'tool_prompt' }>
        if (typeof prompt.id === 'string' && typeof prompt.name === 'string' && actionable.has(prompt.id)) next = operatorReducer(next, { type: 'message', payload: { ...prompt, type: 'tool_prompt' } })
      }
      const approvals = Object.fromEntries(Object.entries(next.approvals).filter(([id]) => actionable.has(id)))
      const missing = [...actionable].some(id => !approvals[id])
      const budget = snapshot.budget as { max_cost_usd?: number } | undefined
      const usage = snapshot.latest_usage as { cost_usd?: number } | undefined
      return { ...next, approvals, revision: snapshot.revision,
        budget: { cost: typeof usage?.cost_usd === 'number' ? usage.cost_usd : next.budget?.cost ?? 0, limit: typeof budget?.max_cost_usd === 'number' ? budget.max_cost_usd : next.budget?.limit },
        recoveryError: missing || snapshot.recovery_incomplete ? 'Some pending action details unavailable from server recovery; cannot safely recreate controls.' : next.recoveryError }
    }
    default: return state
  }
}
