import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { delegateTool, findProfilePath } from '../src/tools/builtin/delegate.js'
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
const TEST_PROMPT_PATH = join(process.cwd(), 'profiles', 'test-delegate-prompt.md')
const TEST_ARTIFACT_DIR = join(process.cwd(), '.harness', 'test-delegate')

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    profile: { profile_path: TEST_PROFILE_PATH } as any,
    session: { user: 'testuser' } as any,
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
    mkdirSync(join(process.cwd(), 'profiles'), { recursive: true })
    writeFileSync(TEST_PROMPT_PATH, '# Test delegate prompt\nYou are a test sub-agent.')
    writeFileSync(TEST_PROFILE_PATH, [
      `name: ${TEST_PROFILE_NAME}`,
      'model:',
      '  base_url: https://api.openai.com/v1',
      '  api_key_env: TEST_DELEGATE_API_KEY',
      '  id: gpt-4o-mini',
      'system_prompt: ./test-delegate-prompt.md',
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

  it('resolves named delegates beside the active profile, never from repository cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'delegate-profile-bundle-'))
    const owner = join(dir, 'owner.yaml')
    const worker = join(dir, 'worker.yaml')
    writeFileSync(owner, 'name: owner')
    writeFileSync(worker, 'name: worker')
    expect(findProfilePath('worker', { profile_path: owner })).toBe(worker)
  })

  it('returns error when delegateDepth reaches the configured max depth', async () => {
    const context = makeContext({ delegateDepth: 2, maxDepth: 2 })
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

  it('propagates parent taint into a delegated run', async () => {
    vi.mocked(runAgentLoop).mockResolvedValue(undefined)
    const context = makeContext({ delegateDepth: 0, taintSources: ['MCP inbox'] })
    await delegateTool.execute({ profile: TEST_PROFILE_NAME, task: 'summarise inbox' }, context)
    expect(vi.mocked(runAgentLoop).mock.calls[0][3]).toMatchObject({ taintSources: ['MCP inbox'] })
  })
})
