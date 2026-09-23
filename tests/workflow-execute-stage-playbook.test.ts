import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { executeStage } from '../src/workflow/runner.js'
import type { Playbook } from '../src/workflow/types.js'

// PT-076 (roadmap #31 phase 1): executeStage must use the *passed* playbook's
// contract()/name, not re-resolve `profile.workflow?.playbook` internally.
// This drives executeStage directly (it is exported from runner.ts for
// exactly this purpose — see the comment above its definition) with a
// playbook object that deliberately differs from the profile's configured
// `workflow.playbook`, and a fake loop that reports what the caller passed
// it as the stage's `playbook` tag.

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'fixture',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-execute-stage-tests',
    working_dir: process.cwd(),
    workflow: { playbook: 'coding', knowledge: { graph: false, generalization_probe: true } }, // deliberately NOT the playbook we pass in
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
    ...overrides,
  }
}

const memory: any = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn() }
const events: any = {
  onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn(),
}

function context(profileValue: any, session: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events, openai: {}, delegateDepth: 0 }
}

describe('executeStage playbook threading (PT-076)', () => {
  it('uses the passed playbook, not profile.workflow.playbook, for the contract and stage tag', async () => {
    const customPlaybook: Playbook = {
      name: 'custom-test-playbook',
      description: 'not the profile playbook',
      stages: ['recon', 'plan', 'design', 'build', 'verify', 'review'],
      task_classes: ['general'],
      defaults: {},
      contract: () => ({ required_sections: ['Custom Marker'], exit_criteria: 'custom exit criteria', prompt: 'custom prompt' }),
    }

    const p = profile()
    const session = createSession(p.name, 'test')
    let observedPlaybookTag: string | undefined
    let observedSeed = ''
    const loop = vi.fn(async (seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
      observedPlaybookTag = opts.stage.playbook
      observedSeed = seed
      staged.messages.push({ role: 'assistant', content: '## Custom Marker\nsatisfied' })
    })

    const plan = { task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 1, design: 0, build: 0, verify: 0, review: 0 }, confidence: 0.9, why: 'test' }

    const result = await executeStage(
      'do the thing', 'plan', 1, 'cheap', 1, 'task-1', plan as any,
      p, customPlaybook, session, context(p, session), events, undefined,
      new AbortController().signal, [], '', loop, false, false,
    )

    // The stage tag handed to the agent loop carries the passed playbook's
    // name, not profile.workflow.playbook ('coding').
    expect(observedPlaybookTag).toBe('custom-test-playbook')
    // The contract's required section (only known to customPlaybook.contract)
    // made it into the seed prompt built from it.
    expect(observedSeed).toContain('Custom Marker')
    // Validation ran against the passed playbook's contract, so the
    // fake-loop's matching body satisfies it.
    expect(result.contract_ok).toBe(true)
  })

  it('emits an identity-bearing start and exactly one bounded close observation', async () => {
    const customPlaybook: Playbook = { name: 'custom-test-playbook', stages: ['recon'], task_classes: ['general'], defaults: {}, contract: () => ({ required_sections: [], exit_criteria: 'done', prompt: '' }) }
    const p = profile()
    const session = createSession(p.name, 'test')
    const observed: any[] = []
    const mapEvents = { ...events, onWorkflowMap: (value: any) => observed.push(value) }
    let stageTag: any
    const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
      stageTag = opts.stage
      staged.messages.push({ role: 'assistant', content: 'done' })
    })
    await executeStage('safe request', 'recon', 1, 'cheap', 1, 'pass-1', { task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1 }, confidence: 1, why: 'test' } as any, p, customPlaybook, session, context(p, session), mapEvents, undefined, new AbortController().signal, [], '', loop, false, false, undefined, { scope: { run_id: 'run-1', session_id: session.id, profile: p.name }, nextTransition: 'start' })
    expect(observed.map(value => value.kind)).toEqual(['attempt_started', 'attempt_updated'])
    expect(observed[0].attempt.attempt_id).toBe(stageTag.stage_id)
    expect(observed[1].attempt).toMatchObject({ state: 'done', cost_usd: 0, contract_ok: true })
    expect(observed[1].attempt.duration_ms).toEqual(expect.any(Number))
  })

  it('closes a thrown attempt once and isolates observer failures from stage execution', async () => {
    const customPlaybook: Playbook = { name: 'custom-test-playbook', stages: ['recon'], task_classes: ['general'], defaults: {}, contract: () => ({ required_sections: [], exit_criteria: 'done', prompt: '' }) }
    const p = profile()
    const session = createSession(p.name, 'test')
    const observed: any[] = []
    const mapEvents = { ...events, onWorkflowMap: (value: any) => observed.push(value) }
    const loop = vi.fn(async () => { throw new Error('fixture failure') })
    await expect(executeStage('safe request', 'recon', 1, 'cheap', 1, 'pass-1', { task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1 }, confidence: 1, why: 'test' } as any, p, customPlaybook, session, context(p, session), mapEvents, undefined, new AbortController().signal, [], '', loop, false, false, undefined, { scope: { run_id: 'run-1', session_id: session.id, profile: p.name }, nextTransition: 'start' })).rejects.toThrow('fixture failure')
    expect(observed.map(value => value.kind)).toEqual(['attempt_started', 'attempt_updated'])
    expect(observed[1].attempt.state).toBe('failed')

    const throwingObserver = { ...events, onWorkflowMap: () => { throw new Error('observer failed') } }
    const succeeds = vi.fn(async (_seed: string, _profile: any, staged: any) => { staged.messages.push({ role: 'assistant', content: 'done' }) })
    const result = await executeStage('safe request', 'recon', 1, 'cheap', 1, 'pass-1', { task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1 }, confidence: 1, why: 'test' } as any, p, customPlaybook, session, context(p, session), throwingObserver, undefined, new AbortController().signal, [], '', succeeds, false, false, undefined, { scope: { run_id: 'run-2', session_id: session.id, profile: p.name }, nextTransition: 'start' })
    expect(result.contract_ok).toBe(true)
    expect(succeeds).toHaveBeenCalledOnce()
  })
})
