import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { clearRegistry } from '../src/tools/registry.js'

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
})
