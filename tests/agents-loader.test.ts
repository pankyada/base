import { describe, it, expect, vi } from 'vitest'
import { loadAgentTools } from '../src/agents/loader.js'
import type { Profile } from '../src/profiles/schema.js'

vi.mock('../src/agents/runner.js', () => ({ runSubAgent: vi.fn() }))
vi.mock('../src/tools/builtin/delegate-fanout.js', () => ({
  buildDelegateFanoutTool: vi.fn().mockReturnValue({
    name: 'DelegateFanout',
    description: 'fanout',
    parameters: {},
    execute: vi.fn(),
  }),
}))

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'orchestrator',
    model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
    system_prompt: './prompt.md',
    artifact_dir: '/tmp',
    working_dir: '/tmp',
    tools: { builtin: {} as any, custom: {}, mcp_servers: [] },
    hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
    improvement: { enabled: false, mine_skills_every_n_sessions: 10 },
    max_depth: 2,
    agents: [],
    ...overrides,
  } as Profile
}

describe('loadAgentTools', () => {
  it('returns empty array when profile has no agents', async () => {
    const tools = await loadAgentTools(makeProfile())
    expect(tools).toEqual([])
  })

  it('returns per-agent tools + DelegateFanout when agents are declared', async () => {
    const profile = makeProfile({
      agents: [
        {
          name: 'researcher',
          profile: './profiles/researcher.yaml',
          input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
        },
        {
          name: 'writer',
          profile: './profiles/writer.yaml',
          input: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
          output: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
        },
      ],
    })

    const tools = await loadAgentTools(profile)

    // 2 per-agent tools + 1 DelegateFanout
    expect(tools).toHaveLength(3)
    expect(tools.map(t => t.name)).toContain('researcher')
    expect(tools.map(t => t.name)).toContain('writer')
    expect(tools.map(t => t.name)).toContain('DelegateFanout')
  })

  it('per-agent tool uses declared input schema as its parameters', async () => {
    const inputSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    const profile = makeProfile({
      agents: [{
        name: 'researcher',
        profile: './profiles/researcher.yaml',
        input: inputSchema,
        output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
      }],
    })

    const tools = await loadAgentTools(profile)
    const researcherTool = tools.find(t => t.name === 'researcher')!
    expect(researcherTool.parameters).toEqual(inputSchema)
  })
})
