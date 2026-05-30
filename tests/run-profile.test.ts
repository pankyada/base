import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runProfileOnce } from '../src/server/run-profile.js'
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
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# system prompt') }
})

const PROFILE = {
  name: 'p', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
  memory: { provider: 'fs' }, system_prompt: '/dev/null', artifact_dir: '/tmp',
  working_dir: '/tmp', max_depth: 2, agents: [],
} as any

function noopEvents() {
  return {
    onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(),
    onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStats: vi.fn(),
  }
}

describe('runProfileOnce', () => {
  beforeEach(() => {
    vi.mocked(runAgentLoop).mockReset()
    vi.mocked(destroyMcpClients).mockReset().mockResolvedValue(undefined)
    vi.mocked(recordUsage).mockReset()
  })

  it('runs the loop and returns final text + usage', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_m, _p, session: any) => {
      session.messages.push({ role: 'assistant', content: 'hello world' })
      session.usage = { input: 10, output: 5, cost_usd: 0.001 }
    })
    const result = await runProfileOnce({ profile: PROFILE, userId: 'alice', userMessage: 'hi', events: noopEvents() })
    expect(result.finalText).toBe('hello world')
    expect(result.usage).toEqual({ tokens_in: 10, tokens_out: 5, cost_usd: 0.001 })
    expect(result.session.id).toBeTruthy()
  })

  it('records usage for the user', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_m, _p, session: any) => {
      session.messages.push({ role: 'assistant', content: 'x' })
      session.usage = { input: 3, output: 4, cost_usd: 0.002 }
    })
    await runProfileOnce({ profile: PROFILE, userId: 'bob', userMessage: 'hi', events: noopEvents() })
    expect(recordUsage).toHaveBeenCalledWith('bob', { input: 3, output: 4, cost_usd: 0.002 })
  })

  it('destroys mcp clients even when the loop throws', async () => {
    vi.mocked(runAgentLoop).mockRejectedValue(new Error('boom'))
    await expect(runProfileOnce({ profile: PROFILE, userId: 'x', userMessage: 'hi', events: noopEvents() }))
      .rejects.toThrow('boom')
    expect(destroyMcpClients).toHaveBeenCalledOnce()
  })
})
