import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'

async function* response() {
  yield { choices: [{ delta: { content: 'done' } }] }
  yield { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1 } }
}

function context(profile: any, session: any): any {
  return { profile, session, workingDir: process.cwd(), memory: {}, skills: [], mcpEntries: [], agentTools: [], delegateDepth: 0 }
}

describe('agent loop model routing', () => {
  it('uses per-stage model override and keeps default fallback', async () => {
    const profile: any = { name: 'test', model: { id: 'base-model', base_url: 'https://api.openai.com/v1' } }
    const calls: any[] = []
    const openai: any = { chat: { completions: { create: vi.fn(async (request: any) => { calls.push(request); return response() }) } } }
    const events: any = { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn() }
    const session = createSession('test', 'user')
    await runAgentLoop('one', profile, session, context(profile, session), events, openai, new AbortController().signal, { modelId: 'stage-model', stage: { task_id: 't', stage_id: 's', stage: 'build', attempt: 1, intensity: 1, tier: 'cheap', task_class: 'bugfix', playbook: 'coding' } })
    const second = createSession('test', 'user')
    await runAgentLoop('two', profile, second, context(profile, second), events, openai, new AbortController().signal)
    expect(calls.map(call => call.model)).toEqual(['stage-model', 'base-model'])
  })
})
