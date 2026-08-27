import { describe, expect, it, vi } from 'vitest'
import { Ajv } from 'ajv'
import { runSubAgent } from '../src/agents/runner.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'

vi.mock('../src/loop/agent-loop.js', () => ({ runAgentLoop: vi.fn(async (_message: string, _profile: unknown, session: any) => {
  session.messages.push({ role: 'assistant', content: JSON.stringify({ ok: true }) })
}) }))
vi.mock('../src/mcp/client.js', () => ({ createMcpClients: vi.fn().mockResolvedValue([]), destroyMcpClients: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/profiles/loader.js', () => ({ loadProfile: vi.fn().mockReturnValue({
  name: 'child', model: { id: 'model', base_url: '', api_key_env: '' }, system_prompt: '/dev/null', artifact_dir: '/tmp', working_dir: '/tmp',
  tools: { builtin: {}, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false }, agents: [],
}) }))
vi.mock('../src/provider/client.js', () => ({ createProviderClient: vi.fn().mockReturnValue({}) }))
vi.mock('../src/skills/loader.js', () => ({ loadAllSkills: vi.fn().mockReturnValue([]), resolveSkillsDirs: vi.fn().mockReturnValue([]) }))
vi.mock('../src/skills/indexer.js', () => ({ buildSkillIndex: vi.fn().mockReturnValue('') }))
vi.mock('../src/context/system-prompt.js', () => ({ buildSystemPrompt: vi.fn().mockResolvedValue('system') }))
vi.mock('../src/memory/fs-memory.js', () => ({ FsMemoryProvider: vi.fn().mockImplementation(function () { return {} }) }))
vi.mock('../src/memory/graph-memory.js', () => ({ GraphMemoryProvider: vi.fn() }))
vi.mock('fs', async importOriginal => ({ ...(await importOriginal<typeof import('fs')>()), readFileSync: vi.fn().mockReturnValue('system') }))

describe('operator spawn taint boundary', () => {
  it('keeps parent taint when origin changes to operator', async () => {
    const ajv = new Ajv()
    const onAgentSpawn = vi.fn()
    const context: any = {
      profile: {}, session: { user: 'u', messages: [], tool_calls: [] }, workingDir: '/tmp', memory: {}, skills: [], mcpEntries: [],
      events: { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(true), onSessionEnd: vi.fn(), onAgentSpawn },
      openai: {}, signal: undefined, delegateDepth: 0, maxDepth: 2, agentOrigin: 'operator', taintSources: ['untrusted result'],
    }
    await runSubAgent({
      agentName: 'researcher', subProfilePath: '/tmp/child.yaml', input: { query: 'x' }, context,
      inputValidator: ajv.compile({ type: 'object', required: ['query'] }), outputValidator: ajv.compile({ type: 'object', required: ['ok'] }), outputSchema: { type: 'object', required: ['ok'] },
    })
    expect(onAgentSpawn.mock.calls[0][0].origin).toBe('operator')
    const childContext = vi.mocked(runAgentLoop).mock.calls[0][3]
    expect(childContext.taintSources).toEqual(['untrusted result'])
  })
})
