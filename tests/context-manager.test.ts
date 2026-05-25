import { describe, it, expect, vi } from 'vitest'
import { maybeCondenseMessages } from '../src/loop/context-manager.js'
import { createSession } from '../src/session/store.js'

function makeProfile(maxTokens = 100_000, modelId?: string): any {
  return {
    name: 'test',
    model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
    context_window: { max_tokens: maxTokens, model_id: modelId },
    hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
  }
}

function makeOpenAI(summary: string): any {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: summary } }],
        }),
      },
    },
  }
}

describe('maybeCondenseMessages', () => {
  it('does nothing when under token limit', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(1_000_000), openai)
    expect(session.messages).toHaveLength(2)
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
  })

  it('condenses when over token limit, inserts summary after system message', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'old-3' },
      { role: 'assistant', content: 'old-4' },
      { role: 'user', content: 'old-5' },
      { role: 'assistant', content: 'old-6' },
      { role: 'user', content: 'old-7' },
      { role: 'assistant', content: 'old-8' },
      { role: 'user', content: 'recent' },
    ]
    const openai = makeOpenAI('the conversation summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    expect(openai.chat.completions.create).toHaveBeenCalled()
    const msgs = session.messages as any[]
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toContain('[Earlier conversation summary:')
    expect(msgs[1].content).toContain('the conversation summary')
  })

  it('preserves last 6 messages verbatim', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'drop-me' },
      { role: 'assistant', content: 'drop-me-too' },
      { role: 'user', content: 'keep-6' },
      { role: 'assistant', content: 'keep-5' },
      { role: 'user', content: 'keep-4' },
      { role: 'assistant', content: 'keep-3' },
      { role: 'user', content: 'keep-2' },
      { role: 'assistant', content: 'keep-1' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    const contents = (session.messages as any[]).map((m: any) => m.content)
    expect(contents).toContain('keep-6')
    expect(contents).toContain('keep-1')
    expect(contents).not.toContain('drop-me')
  })

  it('preserves anchor tool messages (long markdown content)', async () => {
    const session = createSession('test')
    const anchorContent = '# CLAUDE.md\n' + 'x'.repeat(400)
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'read file' },
      { role: 'tool', tool_call_id: 'tc1', content: anchorContent },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'old-3' },
      { role: 'assistant', content: 'old-4' },
      { role: 'user', content: 'old-5' },
      { role: 'assistant', content: 'old-6' },
      { role: 'user', content: 'recent' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    const contents = (session.messages as any[]).map((m: any) => m.content)
    expect(contents).toContain(anchorContent)
  })

  it('does not anchor short tool messages', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'run cmd' },
      { role: 'tool', tool_call_id: 'tc1', content: 'ok' },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'old-3' },
      { role: 'assistant', content: 'old-4' },
      { role: 'user', content: 'old-5' },
      { role: 'assistant', content: 'old-6' },
      { role: 'user', content: 'recent' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    const contents = (session.messages as any[]).map((m: any) => m.content)
    expect(contents).not.toContain('ok') // short tool result dropped
  })

  it('survives summarisation failure gracefully (leaves messages unchanged)', async () => {
    const session = createSession('test')
    const original = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'recent' },
    ]
    session.messages = [...original]
    const openai = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('API error')) } },
    }
    await maybeCondenseMessages(session, makeProfile(10), openai as any)
    expect(session.messages).toHaveLength(original.length)
  })
})
