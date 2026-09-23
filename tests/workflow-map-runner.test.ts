import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runWorkflow } from '../src/workflow/runner.js'
import { BudgetExceeded } from '../src/runs/budget.js'
import { WorkflowMapProjection } from '../src/workflow/map.js'

const memory: any = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn() }
const validBody = [
  '## Files touched\nnone', '## Prior knowledge\nnone', '## Open questions\nnone',
  '## Plan\nsteps', '## Risks\nnone', '## Result\nok', '## Verification\npassed',
].join('\n')

function setup(observer: (value: any) => void, options: { buildIntensity?: number } = {}) {
  const profile: any = {
    name: 'coding', model: { id: 'default', base_url: '', api_key_env: '' }, artifact_dir: '/tmp/workflow-map-runner-tests', working_dir: process.cwd(),
    workflow: {
      enabled: true, playbook: 'generic',
      min_intensity: { recon: 1 }, max_intensity: {},
      budget: { max_usd_per_task: 2, max_stage_retries: 1, max_stage_minutes: 15 },
      routing: { policy: 'static', explore_rate: 0, shadow_rate: 0, table: {} },
      knowledge: { graph: false, generalization_probe: false },
    },
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
  }
  const session = createSession(profile.name, `map-runner-${Math.random()}`)
  const events: any = {
    onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false),
    onSessionEnd: vi.fn(), onStage: vi.fn(), onWorkflowMap: observer,
  }
  const context: any = { profile, session, runId: 'run-map-runner', workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events, openai: {}, delegateDepth: 0 }
  const calls: string[] = []
  const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
    calls.push(opts.stage.stage)
    // The first build fails its contract, causing the existing same-tier retry.
    const body = opts.stage.stage === 'build' && calls.filter(stage => stage === 'build').length === 1 ? 'incomplete' : validBody
    staged.messages.push({ role: 'assistant', content: body })
  })
  const openai: any = { chat: { completions: { create: vi.fn(async (request: any) => ({ choices: [{ message: { content: request.messages[0].content.includes('Classify') ? '{"task_class":"general","recon_intensity":1}' : JSON.stringify({ task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 1, design: 0, build: options.buildIntensity ?? 2, verify: 1, review: 0 }, confidence: 0.9, why: 'test' }) } }] })) } } }
  return { profile, session, events, context, calls, loop, openai }
}

describe('workflow execution map runner observations', () => {
  it('records actual stage IDs and retry branch, then closes exactly once', async () => {
    const observations: any[] = []
    const projection = new WorkflowMapProjection()
    const test = setup(value => {
      observations.push(value)
      projection.begin(value.scope)
      projection.accept(value)
    })
    await runWorkflow('safe fixture request', test.profile, test.session, test.context, test.events, test.openai, new AbortController().signal, { loop: test.loop })

    expect(test.calls.filter(stage => stage === 'build')).toHaveLength(2)
    const starts = observations.filter(value => value.kind === 'attempt_started')
    const closes = observations.filter(value => value.kind === 'attempt_updated')
    expect(starts.length).toBeGreaterThan(0)
    expect(starts.map(value => value.attempt.attempt_id)).toEqual(closes.map(value => value.attempt.attempt_id))
    expect(closes.filter(value => value.attempt.state === 'failed')).toHaveLength(0)
    expect(observations.some(value => value.kind === 'transition' && value.transition.kind === 'retry')).toBe(true)
    expect(observations.filter(value => value.kind === 'terminal')).toHaveLength(1)
    expect(observations.at(-1).terminal).toBe('completed')
    const snapshot = projection.snapshot({ run_id: 'run-map-runner', session_id: test.session.id, profile: test.profile.name })!
    expect(snapshot.attempts.length).toBeGreaterThan(0)
    expect(snapshot.transitions.length).toBeGreaterThan(0)
    expect(snapshot.terminal).toBe('completed')
    expect(JSON.stringify(observations)).not.toContain('safe fixture request')
  })

  it('swallows map observer failures without changing workflow execution or session close', async () => {
    const observer = vi.fn(() => { throw new Error('observer failure') })
    const test = setup(observer)
    await expect(runWorkflow('safe fixture request', test.profile, test.session, test.context, test.events, test.openai, new AbortController().signal, { loop: test.loop })).resolves.toBeUndefined()
    expect(test.calls).toContain('verify')
    expect(observer).toHaveBeenCalled()
    expect(test.events.onSessionEnd).toHaveBeenCalledOnce()
  })

  it('records an actual exploratory tier attempt on the connected path and an intensity-zero skip', async () => {
    const observations: any[] = []
    const test = setup(value => observations.push(value), { buildIntensity: 0 })
    test.profile.workflow.routing.explore_rate = 1
    await runWorkflow('safe fixture request', test.profile, test.session, test.context, test.events, test.openai, new AbortController().signal, { loop: test.loop })

    const starts = observations.filter(value => value.kind === 'attempt_started')
    const closes = observations.filter(value => value.kind === 'attempt_updated')
    const build = starts.find(value => value.attempt.stage === 'build')
    expect(build).toBeDefined()
    expect(closes.find(value => value.attempt.attempt_id === build.attempt.attempt_id)?.attempt.state).toBe('skipped')
    expect(observations.some(value => value.kind === 'transition' && value.transition.kind === 'skip' && value.transition.to_attempt_id === build.attempt.attempt_id)).toBe(true)
    const exploratory = starts.find(value => value.attempt.explore === true)
    expect(exploratory).toBeDefined()
    expect(observations.some(value => value.kind === 'transition' && value.transition.to_attempt_id === exploratory.attempt.attempt_id)).toBe(true)
    expect(starts).toHaveLength(test.calls.length + 1) // includes the stage the runner skipped without invoking the loop
  })

  it('closes thrown and cancelled runs with one terminal observation', async () => {
    const failedObservations: any[] = []
    const failed = setup(value => failedObservations.push(value))
    const failedLoop = vi.fn(async () => { throw new Error('stage broke') })
    await expect(runWorkflow('safe fixture request', failed.profile, failed.session, failed.context, failed.events, failed.openai, new AbortController().signal, { loop: failedLoop })).rejects.toThrow('stage broke')
    expect(failedObservations.filter(value => value.kind === 'attempt_updated').map(value => value.attempt.state)).toEqual(['failed'])
    expect(failedObservations.filter(value => value.kind === 'terminal').map(value => value.terminal)).toEqual(['failed'])

    const abortedObservations: any[] = []
    const aborted = setup(value => abortedObservations.push(value))
    const controller = new AbortController(); controller.abort()
    await runWorkflow('safe fixture request', aborted.profile, aborted.session, aborted.context, aborted.events, aborted.openai, controller.signal, { loop: aborted.loop })
    expect(abortedObservations.filter(value => value.kind === 'terminal').map(value => value.terminal)).toEqual(['cancelled'])
  })

  it('closes a budget-limited open attempt as budget_exceeded before the run terminal', async () => {
    const observations: any[] = []
    const test = setup(value => observations.push(value))
    const loop = vi.fn(async () => { throw new BudgetExceeded('cost', { cost_usd: 2, tools: 0, wall_s: 0 }, 2, 'stage') })
    await expect(runWorkflow('safe fixture request', test.profile, test.session, test.context, test.events, test.openai, new AbortController().signal, { loop })).rejects.toBeInstanceOf(BudgetExceeded)
    expect(observations.filter(value => value.kind === 'attempt_updated').map(value => value.attempt.state)).toEqual(['budget_exceeded'])
    expect(observations.filter(value => value.kind === 'terminal').map(value => value.terminal)).toEqual(['budget_exceeded'])
  })
})
