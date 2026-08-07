import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSession, loadSession, saveSession } from '../src/session/store.js'
import { PendingStore } from '../src/runs/pending.js'
import { RunStore } from '../src/runs/store.js'
import { resumeExpiredInput, resumePendingInput } from '../src/runs/resume.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { destroyMcpClients } from '../src/mcp/client.js'
import { recordUsage } from '../src/usage/ledger.js'

vi.mock('../src/loop/agent-loop.js', () => ({ runAgentLoop: vi.fn() }))
vi.mock('../src/mcp/client.js', () => ({
  createMcpClients: vi.fn().mockResolvedValue([]),
  destroyMcpClients: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/skills/loader.js', () => ({
  loadAllSkills: vi.fn().mockReturnValue([]),
  resolveSkillsDirs: vi.fn().mockReturnValue([]),
}))
vi.mock('../src/skills/indexer.js', () => ({ buildSkillIndex: vi.fn().mockReturnValue('') }))
vi.mock('../src/agents/loader.js', () => ({ loadAgentTools: vi.fn().mockResolvedValue([]) }))
vi.mock('../src/provider/client.js', () => ({ createProviderClient: vi.fn().mockReturnValue({}) }))
vi.mock('../src/usage/ledger.js', () => ({ recordUsage: vi.fn() }))
vi.mock('../src/memory/fs-memory.js', () => ({
  FsMemoryProvider: vi.fn().mockImplementation(function () {
    return { buildSystemPromptSection: vi.fn().mockResolvedValue('') }
  }),
}))
vi.mock('../src/memory/graph-memory.js', () => ({
  GraphMemoryProvider: vi.fn().mockImplementation(function () {
    return { buildSystemPromptSection: vi.fn().mockResolvedValue('') }
  }),
}))

const PROFILE = {
  name: 'restart-profile',
  model: { id: 'test-model', base_url: '', api_key_env: '' },
  memory: { provider: 'fs' },
  system_prompt: '/dev/null',
  artifact_dir: '/tmp/deferred-asks-test-artifacts',
  working_dir: '/tmp',
  max_depth: 2,
  agents: [],
} as any

function events() {
  return {
    onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(),
    onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStats: vi.fn(),
  }
}

function waitingCase(id: string, state: 'open' | 'expired' = 'open') {
  const session = createSession(PROFILE.name, 'alice')
  saveSession(session)
  const runStore = new RunStore()
  runStore.create({
    id, profile: PROFILE.name, user: 'alice', trigger: 'rest', input: {}, status: 'waiting_input',
    session_id: session.id, started_at: '2026-08-07T00:00:00.000Z',
  })
  const pendingStore = new PendingStore()
  const pending = pendingStore.create({
    id: `pending-${id}`, run_id: id, session_id: session.id, user: 'alice', profile: PROFILE.name,
    prompt: 'Choose a window', kind: 'select', options: ['morning', 'evening'], tool_call_id: `tool-${id}`,
    created_at: '2026-08-07T00:00:00.000Z', expires_at: '2026-08-08T00:00:00.000Z', state,
  })
  return { session, pending, pendingStore, runStore }
}

describe('deferred asks across a fresh store restart', () => {
  beforeEach(() => {
    vi.mocked(runAgentLoop).mockReset().mockImplementation(async (_message, _profile, session: any) => {
      const answer = session.messages.find((message: any) => message.role === 'tool')
      if (!answer) throw new Error('resume did not append tool answer')
      session.messages.push({ role: 'assistant', content: 'resumed after restart' })
    })
    vi.mocked(destroyMcpClients).mockReset().mockResolvedValue(undefined)
    vi.mocked(recordUsage).mockReset()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('answers an open question using freshly constructed stores and preserves the ledger', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-deferred-restart-'))
    vi.stubEnv('HOME', home)
    const initial = waitingCase('run-answer')

    // Restart boundary: no store object from the first process is reused.
    const pendingStore = new PendingStore()
    const runStore = new RunStore()
    const result = await resumePendingInput('pending-run-answer', 'evening', 'rest', {
      pendingStore, runStore, abortRegistry: new Map(), resolveProfile: () => PROFILE, events: events(),
    })

    expect(result).toMatchObject({ status: 'completed', run_id: 'run-answer' })
    expect(pendingStore.get(initial.pending.id)).toMatchObject({ state: 'answered', answer: 'evening' })
    expect(runStore.get('run-answer')).toMatchObject({ status: 'completed' })
    const resumed = loadSession('alice', initial.session.id)
    expect(resumed?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'tool-run-answer', content: 'evening' }),
    ]))
  })

  it('expires and resumes a question after restart with the timeout sentinel', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-deferred-expiry-'))
    vi.stubEnv('HOME', home)
    const initial = waitingCase('run-expired')
    initial.pendingStore.sweep(new Date('2026-08-09T00:00:00.000Z'))

    const pendingStore = new PendingStore()
    const runStore = new RunStore()
    const result = await resumeExpiredInput('pending-run-expired', {
      pendingStore, runStore, abortRegistry: new Map(), resolveProfile: () => PROFILE, events: events(),
    })

    expect(result).toMatchObject({ status: 'completed', run_id: 'run-expired' })
    expect(pendingStore.get(initial.pending.id)).toMatchObject({ state: 'expired' })
    const resumed = loadSession('alice', initial.session.id)
    expect(resumed?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'tool-run-expired', content: '[no answer within 1d — proceed without it or stop]' }),
    ]))
  })
})
