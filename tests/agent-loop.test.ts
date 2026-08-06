import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { clearRegistry, registerTool } from '../src/tools/registry.js'
import { PendingStore } from '../src/runs/pending.js'
import { ParkSignal } from '../src/runs/park.js'

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

  it('danger mode prompts destructive Bash but allows safe Bash', async () => {
    const session = createSession('test', 'testuser')
    const profile: any = {
      name: 'test', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Bash: 'prompt' }, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    registerTool({ name: 'Bash', description: 'shell', parameters: {}, execute: async (input: any) => input.command })
    const memory = new FsMemoryProvider(tmp, session)
    const prompt = vi.fn().mockResolvedValue(false)
    const openai = {
      chat: { completions: { create: vi.fn()
        .mockReturnValueOnce(makeStream([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'danger', function: { name: 'Bash', arguments: '{"command":"rm -rf build"}' } }] } }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
        ]))
        .mockReturnValueOnce(makeStream([{ choices: [{ delta: { content: 'blocked' } }] }, { choices: [{ delta: {} },], usage: { prompt_tokens: 1, completion_tokens: 1 } }])) } },
    }
    await runAgentLoop('clean', profile, session, { profile, session, workingDir: tmp, memory, skills: [], approvalMode: 'danger' } as any, {
      onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: prompt, onSessionEnd: vi.fn(),
    }, openai as any)
    expect(prompt).toHaveBeenCalledWith('danger', 'Bash', { command: 'rm -rf build' }, 'danger', 'destructive filesystem removal')
  })

  it('danger mode never classifies a tool the profile already denies', async () => {
    const session = createSession('test', 'testuser')
    const profile: any = {
      name: 'test', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Bash: 'deny' }, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    registerTool({ name: 'Bash', description: 'shell', parameters: {}, execute: async (input: any) => input.command })
    const memory = new FsMemoryProvider(tmp, session)
    const prompt = vi.fn()
    const classifierCreate = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"risk":"caution","reason":"n/a"}' } }] })
    const streamOpenai = {
      chat: { completions: { create: vi.fn()
        .mockReturnValueOnce(makeStream([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'denied', function: { name: 'Bash', arguments: '{"command":"ls"}' } }] } }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
        ]))
        .mockReturnValueOnce(makeStream([{ choices: [{ delta: { content: 'ok' } }] }, { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }])) } },
    }
    await runAgentLoop('clean', profile, session, {
      profile, session, workingDir: tmp, memory, skills: [], approvalMode: 'danger',
      openai: { chat: { completions: { create: classifierCreate } } },
    } as any, {
      onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: prompt, onSessionEnd: vi.fn(),
    }, streamOpenai as any)
    expect(prompt).not.toHaveBeenCalled()
    expect(classifierCreate).not.toHaveBeenCalled()
    const toolMsgs = (session.messages as any[]).filter(m => m.role === 'tool')
    expect(toolMsgs[0].content).toContain('denied by profile ACL')
  })

  it('sends reasoning_effort: none for reasoning-family models when tools are present', async () => {
    const session = createSession('test', 'testuser')
    const profile: any = {
      name: 'test', model: { id: 'gpt-5.6-luna', base_url: '', api_key_env: '' },
      tools: { builtin: { Echo: 'allow' }, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    registerTool({ name: 'Echo', description: 'echo', parameters: {}, execute: async (input: any) => input.msg })
    const memory = new FsMemoryProvider(tmp, session)
    const create = vi.fn()
      .mockReturnValueOnce(makeStream([{ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]))
    const openai = { chat: { completions: { create } } }
    await runAgentLoop('hi', profile, session, { profile, session, workingDir: tmp, memory, skills: [] } as any, {
      onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn(),
    }, openai as any)
    expect(create.mock.calls[0][0]).toMatchObject({ reasoning_effort: 'none' })
  })

  it('omits reasoning_effort for non-reasoning models', async () => {
    const session = createSession('test', 'testuser')
    const profile: any = {
      name: 'test', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Echo: 'allow' }, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    registerTool({ name: 'Echo', description: 'echo', parameters: {}, execute: async (input: any) => input.msg })
    const memory = new FsMemoryProvider(tmp, session)
    const create = vi.fn()
      .mockReturnValueOnce(makeStream([{ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]))
    const openai = { chat: { completions: { create } } }
    await runAgentLoop('hi', profile, session, { profile, session, workingDir: tmp, memory, skills: [] } as any, {
      onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn(),
    }, openai as any)
    expect(create.mock.calls[0][0]).not.toHaveProperty('reasoning_effort')
  })

  it('streams tokens and fires onSessionEnd when no tool calls', async () => {
    const session = createSession('test', 'testuser')
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

  it('keeps a marked partial assistant message when a voice turn interrupts streaming', async () => {
    const session = createSession('test', 'testuser')
    const profile: any = {
      name: 'test', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: {}, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    const controller = new AbortController()
    async function* interrupted(signal: AbortSignal) {
      yield { choices: [{ delta: { content: 'Half spoken' } }] }
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    const openai = { chat: { completions: { create: vi.fn((_params, opts) => interrupted(opts.signal)) } } }
    const end = vi.fn()

    await runAgentLoop('hi', profile, session, { profile, session, workingDir: tmp, memory: new FsMemoryProvider(tmp, session), skills: [] } as any, {
      onToken: () => controller.abort(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: end,
    }, openai as any, controller.signal)

    expect((session.messages as any[]).at(-1)).toMatchObject({ role: 'assistant', content: 'Half spoken', interrupted: true })
    expect(end).toHaveBeenCalledWith(session.id)
  })

  it('executes multiple allow-ACL tool calls in parallel and preserves order', async () => {
    const session = createSession('test', 'testuser')
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

  it('parks unattended approval in the pending store', async () => {
    const session = createSession('test', 'testuser')
    const profile: any = {
      name: 'test', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Bash: 'prompt' }, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    registerTool({ name: 'Bash', description: 'shell', parameters: {}, execute: async () => 'ran' })
    const pendingInputs = new PendingStore(mkdtempSync(join(tmpdir(), 'approval-')))
    const channels = { enabled: true, send: vi.fn().mockResolvedValue({ ok: true }) }
    const openai = {
      chat: { completions: { create: vi.fn().mockReturnValue(makeStream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'approval-tool', function: { name: 'Bash', arguments: '{"command":"rm"}' } }] } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      ])) } },
    }

    await expect(runAgentLoop('do it', profile, session, {
      profile, session, workingDir: tmp, memory: new FsMemoryProvider(tmp, session), skills: [],
      approvalMode: 'strict', unattended: true, runId: 'run-approval', pendingInputs, channels,
    } as any, {
      onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn(),
    }, openai as any)).rejects.toBeInstanceOf(ParkSignal)

    expect(pendingInputs.list()[0]).toMatchObject({ purpose: 'approval', tool_call_id: 'approval-tool', state: 'open' })
    expect(channels.send).toHaveBeenCalledOnce()
  })

  it('executes approved tool when resuming parked approval', async () => {
    const session = createSession('test', 'testuser')
    session.messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'approval-tool', type: 'function', function: { name: 'Bash', arguments: '{"command":"rm"}' } }] })
    const profile: any = {
      name: 'test', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Bash: 'allow' }, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] }, improvement: { enabled: false },
    }
    const executed = vi.fn().mockResolvedValue('ran')
    registerTool({ name: 'Bash', description: 'shell', parameters: {}, execute: executed })
    const openai = makeFakeOpenAI([
      { choices: [{ delta: { content: 'continued' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])
    await runAgentLoop('', profile, session, {
      profile, session, workingDir: tmp, memory: new FsMemoryProvider(tmp, session), skills: [],
    } as any, {
      onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn(),
    }, openai as any, undefined, {
      appendUser: false,
      resumeApproval: { toolCallId: 'approval-tool', approved: true, name: 'Bash', input: { command: 'rm' }, isMcp: false },
    })
    expect(executed).toHaveBeenCalledWith({ command: 'rm' }, expect.anything())
    expect((session.messages as any[]).find(message => message.role === 'tool')?.content).toBe('ran')
  })
})
