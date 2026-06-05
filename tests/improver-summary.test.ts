import { describe, it, expect, vi } from 'vitest'
import { DefaultImprover } from '../src/improver/default-improver.js'
import { createSession } from '../src/session/store.js'

function fakeOpenAI(content: string) {
  return { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } } } as any
}

describe('improver writes a one-line summary back to the session', () => {
  it('sets session.summary from the model output', async () => {
    const profile: any = { name: 'coding', artifact_dir: '/tmp/h-test-improver', model: { id: 'x' }, improvement: { enabled: true } }
    const session = createSession('coding', 'pia')
    session.messages.push({ role: 'user', content: 'do a thing' } as any)
    const improver = new DefaultImprover(profile, fakeOpenAI('{"summary":"Did a thing","memories":[]}'))
    const memory: any = { buildSystemPromptSection: async () => '', write: async () => {} }
    await improver.reflect(session, memory)
    expect(session.summary).toBe('Did a thing')
  })
})
