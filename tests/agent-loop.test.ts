import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { clearRegistry, registerTool } from '../src/tools/registry.js'

async function* makeStream(chunks: any[]) {
  for (const chunk of chunks) yield chunk
}

function makeFakeOpenAI(streamChunks: any[]): any {
  return {
    chat: {
      completions: {
        create: vi.fn(() => makeStream(streamChunks)),
      },
    },
  }
}

describe('runAgentLoop', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'loop-'))

  beforeEach(() => clearRegistry())

  it('streams tokens and fires onSessionEnd when no tool calls', async () => {
    const session = createSession('test')
    const profile: any = {
      name: 'test',
      model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: {}, mcp_servers: [] },
      hooks: { pre_tool: [], post_tool: [], on_stop: [] },
      improvement: { enabled: false },
    }
    const memory = new FsMemoryProvider(tmp, session)
    const ctx: any = { profile, session, workingDir: tmp, memory, skills: [] }

    const openai = makeFakeOpenAI([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: '!' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ])

    const tokens: string[] = []
    let endedId: string | null = null

    await runAgentLoop('hi', profile, session, ctx, {
      onToken: t => tokens.push(t),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onToolPrompt: vi.fn(),
      onSessionEnd: id => { endedId = id },
    }, openai)

    expect(tokens).toEqual(['Hello', '!'])
    expect(endedId).toBe(session.id)
    expect(session.messages).toHaveLength(2) // user + assistant
    expect(session.usage.input).toBe(10)
    expect(session.usage.output).toBe(5)
  })

  it('executes multiple allow-ACL tool calls in parallel and preserves order', async () => {
    const session = createSession('test')
    const profile: any = {
      name: 'test',
      model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Echo: 'allow' }, mcp_servers: [] },
      hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
      improvement: { enabled: false },
    }

    // Register a slow Echo tool that tracks call order by start time
    const callLog: string[] = []
    registerTool({
      name: 'Echo',
      description: 'echo',
      parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
      execute: async (input: any) => {
        callLog.push(`start:${input.msg}`)
        await new Promise(r => setTimeout(r, 30))
        callLog.push(`end:${input.msg}`)
        return input.msg
      },
    })

    const memory = new FsMemoryProvider(tmp, session)
    const ctx: any = { profile, session, workingDir: tmp, memory, skills: [] }

    // Two LLM turns: first returns 2 tool calls, second returns text.
    // Use mockReturnValueOnce per turn — avoids infinite loop from same stream returned twice.
    const openai = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(makeStream([
              { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc1', function: { name: 'Echo', arguments: '{"msg":"A"}' } }] } }] },
              { choices: [{ delta: { tool_calls: [{ index: 1, id: 'tc2', function: { name: 'Echo', arguments: '{"msg":"B"}' } }] } }] },
              { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
            ]))
            .mockReturnValueOnce(makeStream([
              { choices: [{ delta: { content: 'done' } }] },
              { choices: [{ delta: {} }], usage: { prompt_tokens: 20, completion_tokens: 2 } },
            ])),
        },
      },
    }

    const toolEnds: string[] = []
    await runAgentLoop('go', profile, session, ctx, {
      onToken: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: (n, r) => toolEnds.push(r),
      onToolPrompt: vi.fn(),
      onSessionEnd: vi.fn(),
    }, openai as any)

    // Both tools ran
    expect(toolEnds).toContain('A')
    expect(toolEnds).toContain('B')

    // They started before either ended (proving parallelism)
    expect(callLog[0]).toBe('start:A')
    expect(callLog[1]).toBe('start:B')

    // Session messages have tool results in original order (tc1 then tc2)
    const toolMsgs = (session.messages as any[]).filter(m => m.role === 'tool')
    expect(toolMsgs[0].tool_call_id).toBe('tc1')
    expect(toolMsgs[1].tool_call_id).toBe('tc2')
  })
})
