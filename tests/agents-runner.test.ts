import { describe, it, expect, vi, beforeEach } from 'vitest'
import Ajv from 'ajv'
import { runSubAgent, SubAgentParams } from '../src/agents/runner.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createMcpClients, destroyMcpClients } from '../src/mcp/client.js'

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
vi.mock('../src/provider/client.js', () => ({ createProviderClient: vi.fn().mockReturnValue({}) }))
vi.mock('../src/profiles/loader.js', () => ({
  loadProfile: vi.fn().mockReturnValue({
    name: 'sub',
    model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
    tools: { builtin: {}, mcp_servers: [] },
    hooks: { pre_tool: [], post_tool: [], on_stop: [] },
    improvement: { enabled: false },
    memory: { provider: 'fs' },
    system_prompt: '/dev/null',
    artifact_dir: '/tmp',
    working_dir: '/tmp',
    max_depth: 2,
    agents: [],
  }),
}))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# system prompt') }
})

const ajv = new Ajv()

const INPUT_SCHEMA = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
const OUTPUT_SCHEMA = { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] }

function makeParams(overrides: Partial<SubAgentParams> = {}): SubAgentParams {
  return {
    agentName: 'researcher',
    subProfilePath: '/profiles/researcher.yaml',
    inputValidator: ajv.compile(INPUT_SCHEMA),
    outputValidator: ajv.compile(OUTPUT_SCHEMA),
    outputSchema: OUTPUT_SCHEMA,
    input: { query: 'test query' },
    context: {
      profile: {} as any,
      session: { user: 'testuser', messages: [], tool_calls: [] } as any,
      workingDir: '/tmp',
      memory: {} as any,
      skills: [],
      mcpEntries: [],
      events: {
        onToken: vi.fn(),
        onToolStart: vi.fn(),
        onToolEnd: vi.fn(),
        onToolPrompt: vi.fn().mockResolvedValue(true),
        onSessionEnd: vi.fn(),
        onStats: vi.fn(),
      },
      openai: {} as any,
      delegateDepth: 0,
      maxDepth: 2,
      agentTools: [],
    },
    ...overrides,
  }
}

describe('runSubAgent', () => {
  beforeEach(() => {
    vi.mocked(runAgentLoop).mockReset()
    vi.mocked(destroyMcpClients).mockReset().mockResolvedValue(undefined)
  })

  it('returns error without running loop when input fails schema validation', async () => {
    const params = makeParams({ input: { wrong_field: 123 } })
    const result = await runSubAgent(params)
    expect(result).toContain('input validation failed')
    expect(result).toContain('researcher')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('returns error without running loop when max depth exceeded', async () => {
    const params = makeParams({ context: { ...makeParams().context, delegateDepth: 2, maxDepth: 2 } })
    const result = await runSubAgent(params)
    expect(result).toContain('max delegation depth')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('runs sub-agent and returns validated JSON output on success', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session: any) => {
      session.messages.push({ role: 'assistant', content: JSON.stringify({ findings: 'Paris is the capital.' }) })
    })
    const result = await runSubAgent(makeParams())
    expect(JSON.parse(result)).toEqual({ findings: 'Paris is the capital.' })
    expect(runAgentLoop).toHaveBeenCalledOnce()
    expect(destroyMcpClients).toHaveBeenCalledOnce()
  })

  it('returns error when sub-agent output is not valid JSON', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session: any) => {
      session.messages.push({ role: 'assistant', content: 'This is plain text, not JSON.' })
    })
    const result = await runSubAgent(makeParams())
    expect(result).toContain('non-JSON output')
  })

  it('returns error when sub-agent output fails schema validation', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session: any) => {
      session.messages.push({ role: 'assistant', content: JSON.stringify({ wrong_key: 'oops' }) })
    })
    const result = await runSubAgent(makeParams())
    expect(result).toContain('output validation failed')
  })
})
