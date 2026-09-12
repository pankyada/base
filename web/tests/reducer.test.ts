import { describe, expect, it } from 'vitest'
import { reducer, type State } from '../lib/reducer'

const base: State = {
  messages: [], tabs: [], activeTab: 0, input: '', busy: false, focusPane: 'conv', paletteOpen: false,
  tokens: { in: 0, out: 0 }, pendingApproval: null, tweaksOpen: false, theme: 'dark', palette: 'amber', density: 'regular',
  todos: [], pendingInputRequest: null, pendingCodeExecution: null, profile: 'test', sessionId: 's', activeProject: 'inbox', activeProjectName: 'Inbox', projects: [], history: [],
}

describe('protocol reducer', () => {
  it('clears session-dependent state when scope changes before the new handshake', () => {
    const scoped = { ...base, profile: 'other', sessionId: 'session-other', messages: [{ id: 'old', role: 'user' as const, content: 'private A' }], input: 'draft', sendError: 'old scope', busy: true, tokens: { in: 4, out: 2 }, costUsd: 0.4, usage: { input_tokens: 4, output_tokens: 2 } as any }
    const reset = reducer(scoped, { type: 'RESET_SCOPE' })
    expect(reset.profile).toBe('other')
    expect(reset.sessionId).toBe('…')
    expect(reset.messages).toEqual([])
    expect(reset.input).toBe('draft')
    expect(reset.busy).toBe(false)
    expect(reset.sendError).toBeUndefined()
    expect(reset.tokens).toEqual({ in: 0, out: 0 })
    expect(reset.usage).toBeUndefined()
  })
  it('resets session and project selection so a new identity cannot inherit old routing', () => {
    const scoped = { ...base, profile: 'other', sessionId: 'session-a', activeProject: 'private-a', activeProjectName: 'Private A', messages: [{ id: 'old', role: 'user' as const, content: 'private A' }] }
    const reset = reducer(scoped, { type: 'RESET_SCOPE' })
    expect(reset.sessionId).toBe('…')
    expect(reset.activeProject).toBe('inbox')
    expect(reset.activeProjectName).toBe('Inbox')
  })
  it('retains profile catalog while replacing the active session scope', () => {
    const scoped = { ...base, profiles: [{ name: 'test' }, { name: 'other' }] as any, sessionId: 'session-a' }
    expect(reducer(scoped, { type: 'RESET_SCOPE' }).profiles).toHaveLength(2)
  })
  it('keeps concurrent run lanes separate', () => {
    const one = reducer(base, { type: 'SERVER_MSG', payload: { type: 'turn_start', run_id: 'r1' } })
    const two = reducer(one, { type: 'SERVER_MSG', payload: { type: 'token', run_id: 'r1', content: 'one' } })
    const three = reducer(two, { type: 'SERVER_MSG', payload: { type: 'turn_start', run_id: 'r2' } })
    const four = reducer(three, { type: 'SERVER_MSG', payload: { type: 'token', run_id: 'r2', content: 'two' } })

    expect(four.runs?.r1.messages.at(-1)?.content).toBe('one')
    expect(four.runs?.r2.messages.at(-1)?.content).toBe('two')
  })

  it('retains stats, stage, notices, models, approval, pending, and undo state', () => {
    let state = reducer(base, { type: 'SERVER_MSG', payload: { type: 'stats', tokens_in: 3, tokens_out: 4, cost_usd: 0.2, context_tokens: 8, context_window: 10 } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'stage', stage: 'build', intensity: 2, tier: 'balanced', model: 'm', state: 'start', cost_usd: 0.1 } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'notice', level: 'warn', message: 'watch', detail: 'detail' } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'models', models: [], current: 'm' } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'approval_mode_changed', mode: 'strict' } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'pending', pending: [] } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'undo_entries', entries: [] } })

    expect(state.tokens).toEqual({ in: 3, out: 4 })
    expect(state.costUsd).toBe(0.2)
    expect(state.context).toEqual({ tokens: 8, window: 10 })
    expect(state.stages?.at(-1)?.stage).toBe('build')
    expect(state.notices?.at(-1)?.message).toBe('watch')
    expect(state.approvalMode).toBe('strict')
    expect(state.pending).toEqual([])
    expect(state.undoEntries).toEqual([])
  })

  it('ignores deferred voice messages and unknown future messages safely', () => {
    const voice = reducer(base, { type: 'SERVER_MSG', payload: { type: 'transcript_partial', text: 'hi', final: false } })
    const future = reducer(voice, { type: 'SERVER_MSG', payload: { type: 'future_variant' } as never })
    expect(future).toEqual(voice)
  })

  it('queues concurrent approval prompts instead of dropping the second', () => {
    const first = reducer(base, { type: 'SERVER_MSG', payload: { type: 'tool_prompt', id: 'a', name: 'Write', input: {}, risk: 'danger' } })
    const second = reducer(first, { type: 'SERVER_MSG', payload: { type: 'tool_prompt', id: 'b', name: 'Bash', input: {}, risk: 'caution' } })
    const resolved = reducer(second, { type: 'RESOLVE_APPROVAL' })
    expect(resolved.pendingApproval?.id).toBe('b')
  })

  it('carries the live budget limit and terminal budget status', () => {
    let state = reducer(base, { type: 'SERVER_MSG', payload: { type: 'session_ready', sessionId: 's', profile: 'test', budget: { max_cost_usd: 1 }, yolo: false } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'turn_start', run_id: 'budget-run' } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'stats', run_id: 'budget-run', tokens_in: 1, tokens_out: 1, cost_usd: 1, context_tokens: 2 } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'session_end', run_id: 'budget-run', sessionId: 's', status: 'budget_exceeded', reason: 'cost' } })
    expect(state.budget).toEqual({ cost: 1, limit: 1 })
    expect(state.runs?.['budget-run']?.status).toBe('budget_exceeded')
  })

  it('adopts the resumed session\'s own profile on session_resumed (PT-033: resume can switch profiles)', () => {
    const state = reducer(base, { type: 'SERVER_MSG', payload: { type: 'session_resumed', sessionId: 's2', profile: 'research' } })
    expect(state.sessionId).toBe('s2')
    expect(state.profile).toBe('research')
  })

  it('retains server-owned runtime and mission receipts for attached clients', () => {
    let state = reducer(base, { type: 'SERVER_MSG', payload: { type: 'runtime', snapshot: { session_id: 's', user: 'u', revision: 2, status: 'running', last_seq: 4, events: [], gap: false } } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'mission', mission: { id: 'm', status: 'accepted', revision: 2, outcome: 'ship', criteria: [{ id: 'c', description: 'works', state: 'verified' }] }, receipts: [{ id: 'r' }] } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'receipt', receipt: { id: 'r', accepted: true } } })
    expect(state.runtime?.last_seq).toBe(4)
    expect(state.mission?.status).toBe('accepted')
    expect(state.missionReceipts).toEqual([{ id: 'r' }])
    expect(state.receipt).toEqual({ id: 'r', accepted: true })
  })

  it('restores only server-retained approval details from the current runtime snapshot', () => {
    const state = reducer(base, { type: 'SERVER_MSG', payload: { type: 'runtime', snapshot: {
      session_id: 's', user: 'u', revision: 2, status: 'running', last_seq: 4, events: [], gap: false,
      actionable_ids: ['approval'], actionable: [{ id: 'approval', name: 'Bash', input: { command: 'true' }, risk: 'danger' }],
    } } })
    expect(state.pendingApproval).toMatchObject({ id: 'approval', name: 'Bash', input: { command: 'true' } })
  })
})
