import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { buildSystemPrompt } from '../src/context/system-prompt.js'
import { recordUsage, readUsage } from '../src/usage/ledger.js'
import { ReplayStore } from '../src/replay/store.js'
import { newJournal, recordEvent } from '../src/replay/index.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../src/context/project-context.js', () => ({
  loadProjectContext: vi.fn(() => '\nPROJECT-INSTRUCTIONS\n'),
}))

const profile = {
  name: 'fixture',
  model: { auth: 'api_key', id: 'fixture-model', base_url: 'http://127.0.0.1', api_key_env: 'FIXTURE_KEY' },
  context: { project_files: true },
} as any

function events() {
  return {
    onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(),
    onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStats: vi.fn(),
  }
}

describe('Core S6 prompt and execution audit', () => {
  it('assembles profile, project instructions, skills, and memory in declared precedence', async () => {
    const diagnostics: any[] = []
    const assembled = await buildSystemPrompt({
      profile,
      systemPromptBase: 'PROFILE-INSTRUCTIONS',
      skillIndex: '\nSKILL-INSTRUCTIONS',
      memory: { buildSystemPromptSection: vi.fn().mockResolvedValue('\nMEMORY-INSTRUCTIONS') } as any,
      onDiagnostics: value => diagnostics.push(value),
    })
    expect(assembled).toBe('PROFILE-INSTRUCTIONS\nPROJECT-INSTRUCTIONS\n\nSKILL-INSTRUCTIONS\nMEMORY-INSTRUCTIONS')
    expect(diagnostics[0]).toMatchObject({ ordering: ['profile', 'project', 'skills', 'memory'], sizes: { total: assembled.length } })
    expect(JSON.stringify(diagnostics)).not.toContain('PROFILE-INSTRUCTIONS')
    expect(JSON.stringify(diagnostics)).not.toContain('PROJECT-INSTRUCTIONS')
    expect(JSON.stringify(diagnostics)).not.toContain('MEMORY-INSTRUCTIONS')
  })

  it('honours the profile project-files kill switch while preserving memory', async () => {
    const assembled = await buildSystemPrompt({
      profile: { ...profile, context: { project_files: false } },
      systemPromptBase: 'PROFILE', skillIndex: '\nSKILLS',
      memory: { buildSystemPromptSection: vi.fn().mockResolvedValue('\nMEMORY') } as any,
    })
    expect(assembled).toBe('PROFILE\nSKILLS\nMEMORY')
  })

  it('propagates cancellation through provider stream and emits interrupted terminal state only', async () => {
    const session = createSession('fixture', 'cancel-user')
    const controller = new AbortController()
    let signalSeen: AbortSignal | undefined
    let started!: () => void
    let yielded!: () => void
    const streamStarted = new Promise<void>(resolve => { started = resolve })
    const textYielded = new Promise<void>(resolve => { yielded = resolve })
    const provider = {
      kind: 'api_key', model: 'fixture-model',
      stream: async function* (_request: any, context: any) {
        signalSeen = context?.signal
        started()
        yield { type: 'text', delta: 'partial' }
        yielded()
        await new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true }))
        yield { type: 'done', result: { text: 'late success', toolCalls: [], finishReason: 'stop' } }
      },
      generate: vi.fn(),
    } as any
    const seen = events()
    const running = runAgentLoop('cancel me', profile, session, {
      profile, session, workingDir: '/tmp', memory: { buildSystemPromptSection: async () => '' } as any,
      skills: [], mcpEntries: [], events: seen, provider, delegateDepth: 0, maxDepth: 1,
    } as any, seen as any, undefined, controller.signal)
    await streamStarted
    await textYielded
    controller.abort()
    await running
    expect(signalSeen?.aborted).toBe(true)
    expect(seen.onSessionEnd).toHaveBeenCalledOnce()
    expect(session.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'cancel me' }),
      expect.objectContaining({ role: 'assistant', content: 'partial', interrupted: true }),
    ]))
    expect(session.messages).not.toContainEqual(expect.objectContaining({ content: 'late success', interrupted: undefined }))
    expect(seen.onStats).not.toHaveBeenCalled()
  })

  it('keeps usage status and persisted terminal journal explicit for fixture runs', () => {
    const usageRoot = mkdtempSync(join(tmpdir(), 'harness-s6-usage-'))
    const replayRoot = mkdtempSync(join(tmpdir(), 'harness-s6-replay-'))
    try {
      recordUsage('cancel-user', { input: 4, output: 2, cost_usd: 0.01, usage_status: 'unknown' }, usageRoot)
      expect(readUsage('cancel-user', usageRoot)?.total).toMatchObject({ input: 4, output: 2, cost_usd: 0.01, usage_status: 'unknown' })
      const journal = newJournal({ user: 'cancel-user', session_id: 'run-fixture', profile: 'fixture', config_fingerprint: 'fixture', mode: 'live-branch' })
      recordEvent(journal, 'result', { status: 'cancelled', run_id: 'run-fixture', usage_status: 'unknown' }, 'session_end')
      new ReplayStore('cancel-user', replayRoot).save(journal)
      expect(new ReplayStore('cancel-user', replayRoot).get(journal.id)?.events.at(-1)?.payload).toEqual({ status: 'cancelled', run_id: 'run-fixture', usage_status: 'unknown' })
    } finally {
      rmSync(usageRoot, { recursive: true, force: true })
      rmSync(replayRoot, { recursive: true, force: true })
    }
  })
})
