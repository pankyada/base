import { describe, expect, it, vi, beforeEach } from 'vitest'
import { contextRestoreTool } from '../src/tools/builtin/context-restore.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { clearRegistry, registerTool } from '../src/tools/registry.js'

describe('ContextRestore', () => {
  const context = (session: any) => ({ session } as any)

  it('returns a full stored result by id', async () => {
    const session = createSession('test', 'user')
    session.tool_calls.push({ id: 'call_a1', name: 'Read', input: {}, result: 'full result', ok: true, ts: '' })
    await expect(contextRestoreTool.execute({ id: 'call_a1' }, context(session))).resolves.toBe('full result')
  })

  it('returns a slice and remaining marker when limited', async () => {
    const session = createSession('test', 'user')
    session.tool_calls.push({ id: 'call_a1', name: 'Read', input: {}, result: 'abcdefghij', ok: true, ts: '' })
    await expect(contextRestoreTool.execute({ id: 'call_a1', offset: 2, limit: 3 }, context(session)))
      .resolves.toBe('cde\n[… 5 chars remain]')
  })

  it('does not throw for unknown or legacy ids', async () => {
    const session = createSession('test', 'user')
    session.tool_calls.push({ name: 'Read', input: {}, result: 'old', ok: true, ts: '' })
    await expect(contextRestoreTool.execute({ id: 'unknown' }, context(session))).resolves.toContain('not available in this session')
    await expect(contextRestoreTool.execute({ id: 'old' }, context(session))).resolves.toContain('not available in this session')
  })

  it('stores tool-call ids in the session ledger', async () => {
    beforeEach(() => clearRegistry())
    clearRegistry()
    registerTool({
      name: 'Echo', description: 'echo', parameters: {}, execute: async () => 'stored output',
    })
    const session = createSession('test', 'user')
    const profile: any = {
      name: 'test', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Echo: 'allow' }, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    async function* stream(chunks: any[]) { for (const chunk of chunks) yield chunk }
    const openai: any = { chat: { completions: { create: vi.fn()
      .mockReturnValueOnce(stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_echo', function: { name: 'Echo', arguments: '{}' } }] } }] }, { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]))
      .mockReturnValueOnce(stream([{ choices: [{ delta: { content: 'done' } }] }, { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }])) } } }
    await runAgentLoop('run', profile, session, { profile, session, mcpEntries: [], skills: [], events: {}, memory: {} } as any, { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn() }, openai)
    expect(session.tool_calls).toHaveLength(1)
    expect(session.tool_calls[0].id).toBe('call_echo')
  })
})
