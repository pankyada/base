import { describe, expect, it, vi } from 'vitest'
import { project } from '../src/context/projection.js'
import { estimateTokens } from '../src/context/estimator.js'
import { createSession } from '../src/session/store.js'

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'test', model: { id: 'main', base_url: 'https://example.com', api_key_env: 'KEY' },
    context: { max_tokens: 2000, high_water: 0.8, low_water: 0.45, tail_turns: 1, pin_budget: 0.25, cache: false, ...overrides },
  }
}

function openai(response = '{"digest":"folded","facts":[]}') {
  return { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: response } }] }) } } } as any
}

function turn(n: number, content = `turn ${n}`): unknown[] {
  return [{ role: 'user', content }, { role: 'assistant', content: `answer ${n}` }]
}

describe('context projection', () => {
  it('orders system, digest, then live ledger messages', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 'system' }, ...turn(1), { role: 'user', content: 'live' })
    session.context = { pins: [], digest: { upto: 3, text: 'earlier' }, calib: { ratio: 1, samples: 0 } }
    const projected: any[] = await project(session, profile(), openai())
    expect(projected[0]).toMatchObject({ role: 'system', content: 'system' })
    expect(projected[1]).toEqual({ role: 'user', content: '[Earlier session digest: earlier]' })
    expect(projected[2]).toEqual({ role: 'user', content: 'live' })
  })

  it('keeps the last tail turn verbatim', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 's' }, ...turn(1, 'old '.repeat(400)), ...turn(2, 'tail user'))
    const projected: any[] = await project(session, profile({ max_tokens: 220 }), openai())
    expect(projected.some(message => message.content === 'tail user')).toBe(true)
    expect(projected.some(message => message.content === 'answer 2')).toBe(true)
  })

  it('elides large old tool results before calling the digest model', async () => {
    const session = createSession('test', 'user')
    session.messages.push(
      { role: 'system', content: 's' },
      { role: 'user', content: 'old' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function', function: { name: 'Read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_old', content: 'x'.repeat(5000) },
      ...turn(2, 'tail'),
    )
    const ai = openai()
    const projected: any[] = await project(session, profile({ max_tokens: 1000 }), ai)
    const tool = projected.find(message => message.role === 'tool')
    expect(tool.content).toContain('ContextRestore("call_old")')
    expect(tool.tool_call_id).toBe('call_old')
    expect(ai.chat.completions.create).not.toHaveBeenCalled()
  })

  it('never leaves an assistant tool call without its tool results', async () => {
    const session = createSession('test', 'user')
    session.messages.push(
      { role: 'system', content: 's' },
      { role: 'user', content: 'old' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function', function: { name: 'Read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_old', content: 'x'.repeat(3000) },
      { role: 'assistant', content: 'closed' },
      ...turn(2, 'tail'),
    )
    const projected: any[] = await project(session, profile({ max_tokens: 400 }), openai())
    for (const message of projected.filter(message => message.role === 'assistant' && message.tool_calls)) {
      for (const call of message.tool_calls) expect(projected).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: call.id }))
    }
  })

  it('folds only whole turns and leaves the ledger unchanged', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 's' }, ...turn(1, 'old '.repeat(300)), ...turn(2, 'tail'))
    const before = JSON.stringify(session.messages)
    const ai = openai()
    const projected: any[] = await project(session, profile({ max_tokens: 180 }), ai)
    expect(ai.chat.completions.create).toHaveBeenCalled()
    expect(projected[1].content).toContain('Earlier session digest')
    expect(JSON.stringify(session.messages)).toBe(before)
  })

  it('falls through to dropped turns when digest fails and emits notice', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 's' }, ...turn(1, 'old '.repeat(500)), ...turn(2, 'tail'))
    const notice = vi.fn()
    const projected = await project(session, profile({ max_tokens: 100 }), { chat: { completions: { create: vi.fn().mockRejectedValue(new Error('down')) } } } as any, undefined, notice)
    expect(estimateTokens(projected, session)).toBeLessThanOrEqual(100)
    expect(notice).toHaveBeenCalled()
    expect(JSON.stringify(session.messages)).toContain('old ')
  })

  it('does not re-run digest on subsequent projections below the water line', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 's' }, ...turn(1, 'old '.repeat(300)), ...turn(2, 'tail'))
    const ai = openai()
    await project(session, profile({ max_tokens: 180 }), ai)
    const calls = ai.chat.completions.create.mock.calls.length
    await project(session, profile({ max_tokens: 180 }), ai)
    expect(ai.chat.completions.create.mock.calls.length).toBe(calls)
  })
})
