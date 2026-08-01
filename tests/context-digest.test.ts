import { describe, expect, it, vi } from 'vitest'
import { buildDigest } from '../src/context/digest.js'
import { createSession } from '../src/session/store.js'

const profile: any = {
  name: 'test',
  model: { id: 'main', base_url: 'https://example.com', api_key_env: 'KEY' },
  models: { roles: { cheap: 'cheap-model' } },
  context: { max_tokens: 1000, high_water: 0.8, low_water: 0.45, tail_turns: 3, pin_budget: 0.25, digest_model_id: undefined, cache: false },
}

function memory() {
  return { write: vi.fn().mockResolvedValue(undefined) } as any
}

describe('context digest', () => {
  it('requests digest and facts JSON, then promotes facts to project memory', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 'system' }, { role: 'user', content: 'remember x' })
    const mem = memory()
    const openai: any = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"digest":"summary","facts":[{"text":"fact one","tags":["x"]}]}' } }] }) } } }
    const result = await buildDigest(session, profile, openai, 2, mem)
    expect(result).toEqual({ text: 'summary', facts: [{ text: 'fact one', tags: ['x'] }] })
    expect(mem.write).toHaveBeenCalledWith('project', expect.any(String), 'fact one')
    expect(openai.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'cheap-model' }))
    expect(openai.chat.completions.create.mock.calls[0][0].messages[0].content).toContain('digest')
    expect(openai.chat.completions.create.mock.calls[0][0].messages[0].content).toContain('facts')
  })

  it('returns plain text when JSON is malformed and null when provider has no text', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 'system' }, { role: 'user', content: 'history' })
    const openai: any = { chat: { completions: { create: vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: 'plain summary' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })
      .mockRejectedValueOnce(new Error('down')) } } }
    await expect(buildDigest(session, profile, openai, 2)).resolves.toEqual({ text: 'plain summary', facts: [] })
    await expect(buildDigest(session, profile, openai, 2)).resolves.toBeNull()
    await expect(buildDigest(session, profile, openai, 2)).resolves.toBeNull()
  })

  it('regenerates from ledger history rather than nesting an earlier digest', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 'system' }, { role: 'user', content: 'first' }, { role: 'assistant', content: 'second' })
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"digest":"one","facts":[]}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"digest":"two","facts":[]}' } }] })
    const openai: any = { chat: { completions: { create } } }
    await buildDigest(session, profile, openai, 2)
    await buildDigest(session, profile, openai, 3)
    expect(create.mock.calls[1][0].messages[0].content).toContain('first')
    expect(create.mock.calls[1][0].messages[0].content).toContain('second')
    expect(create.mock.calls[1][0].messages[0].content).not.toContain('one')
  })

  it('honours explicit digest model, then cheap role, then main model', async () => {
    const session = createSession('test', 'user')
    session.messages.push({ role: 'system', content: 'system' }, { role: 'user', content: 'history' })
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"digest":"ok","facts":[]}' } }] })
    const openai: any = { chat: { completions: { create } } }
    await buildDigest(session, { ...profile, context: { ...profile.context, digest_model_id: 'explicit' } }, openai, 2)
    expect(create.mock.calls[0][0].model).toBe('explicit')
  })
})
