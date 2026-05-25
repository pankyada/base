import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { delegateTool } from '../src/tools/builtin/delegate.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { destroyMcpClients } from '../src/mcp/client.js'
import type { ToolContext } from '../src/tools/types.js'

// vi.mock is hoisted by Vitest before imports — runAgentLoop above resolves to the mock
vi.mock('../src/loop/agent-loop.js', () => ({
  runAgentLoop: vi.fn(),
}))

vi.mock('../src/mcp/client.js', () => ({
  createMcpClients: vi.fn().mockResolvedValue([]),
  destroyMcpClients: vi.fn().mockResolvedValue(undefined),
}))

const TEST_PROFILE_NAME = 'test-delegate'
const TEST_PROFILE_PATH = join(process.cwd(), 'profiles', `${TEST_PROFILE_NAME}.yaml`)
const TEST_PROMPT_PATH = join(process.cwd(), 'prompts', 'test-delegate-prompt.md')
const TEST_ARTIFACT_DIR = join(process.cwd(), '.harness', 'test-delegate')

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    profile: {} as any,
    session: {} as any,
    workingDir: process.cwd(),
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
    signal: undefined,
    delegateDepth: 0,
    ...overrides,
  }
}

describe('Delegate tool', () => {
  beforeAll(() => {
    mkdirSync(join(process.cwd(), 'profiles'), { recursive: true })
    mkdirSync(join(process.cwd(), 'prompts'), { recursive: true })
    writeFileSync(TEST_PROMPT_PATH, '# Test delegate prompt\nYou are a test sub-agent.')
    writeFileSync(TEST_PROFILE_PATH, [
      `name: ${TEST_PROFILE_NAME}`,
      'model:',
      '  base_url: https://api.openai.com/v1',
      '  api_key_env: TEST_DELEGATE_API_KEY',
      '  id: gpt-4o-mini',
      'system_prompt: ./prompts/test-delegate-prompt.md',
      'working_dir: $CWD',
      `artifact_dir: ${TEST_ARTIFACT_DIR}`,
      'tools:',
      '  builtin: {}',
      '  mcp_servers: []',
    ].join('\n'))
    process.env.TEST_DELEGATE_API_KEY = 'test-key-xxx'
  })

  afterAll(() => {
    rmSync(TEST_PROFILE_PATH, { force: true })
    rmSync(TEST_PROMPT_PATH, { force: true })
    delete process.env.TEST_DELEGATE_API_KEY
  })

  beforeEach(() => {
    vi.mocked(runAgentLoop).mockReset()
    vi.mocked(destroyMcpClients).mockReset()
    vi.mocked(destroyMcpClients).mockResolvedValue(undefined)
  })

  it('returns error when delegateDepth >= 1 (max depth exceeded)', async () => {
    const context = makeContext({ delegateDepth: 1 })
    const result = await delegateTool.execute(
      { profile: 'coding', task: 'do something' },
      context
    )
    expect(result).toContain('cannot delegate')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('returns error when profile does not exist', async () => {
    const context = makeContext({ delegateDepth: 0 })
    const result = await delegateTool.execute(
      { profile: 'nonexistent-profile-xyz', task: 'do something' },
      context
    )
    expect(result).toContain('not found')
    expect(result).toContain('nonexistent-profile-xyz')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('runs sub-agent and returns final text with tool summary', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session) => {
      session.messages.push({ role: 'assistant', content: 'Task complete.' })
      session.tool_calls.push({ name: 'Read', input: {}, result: 'ok', ok: true, ts: new Date().toISOString() })
      session.tool_calls.push({ name: 'Read', input: {}, result: 'ok', ok: true, ts: new Date().toISOString() })
      session.tool_calls.push({ name: 'Bash', input: {}, result: 'done', ok: true, ts: new Date().toISOString() })
    })

    const context = makeContext({ delegateDepth: 0 })
    const result = await delegateTool.execute(
      { profile: TEST_PROFILE_NAME, task: 'read a file and run a command' },
      context
    )

    expect(result).toContain(`[Delegate: ${TEST_PROFILE_NAME}]`)
    expect(result).toContain('Task complete.')
    expect(result).toContain('Read ×2')
    expect(result).toContain('Bash ×1')
    expect(runAgentLoop).toHaveBeenCalledOnce()
    expect(destroyMcpClients).toHaveBeenCalledOnce()
  })
})
