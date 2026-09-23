import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runWorkflow } from '../src/workflow/runner.js'
import { DecisionRuntimeService } from '../src/decisions/runtime.js'
import { telemetryFilePath } from '../src/telemetry/logger.js'
import { readFileSync, existsSync, rmSync } from 'fs'

// Roadmap #31 phase 4 (PT-079), spec §5.4/§6 "Phase 4". Runtime integration
// tests for edge checks + re-route: shares the fake-loop / mock-decision-
// provider style of tests/workflow-router-runtime.test.ts (phase 2) and
// tests/workflow-router-enforce.test.ts (phase 3).

function readTelemetryLines(): any[] {
  if (!existsSync(telemetryFilePath())) return []
  return readFileSync(telemetryFilePath(), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'coding',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-router-edge-tests',
    working_dir: process.cwd(),
    workflow: {
      enabled: true, playbook: 'generic',
      // Not fixed-triage (min !== max), so triageA/triageB run through the
      // mocked `openai` below with a fixed confidence of 0.9 — avoids the
      // fixed-triage default plan's 0.25 confidence, which would otherwise
      // spuriously escalate every stage via `shouldEscalate`'s low-confidence
      // check and confound these tests' stage-sequence assertions.
      min_intensity: { recon: 1 }, max_intensity: {},
      budget: { max_usd_per_task: 2, max_stage_retries: 2, max_stage_minutes: 15 },
      routing: { policy: 'static', explore_rate: 0, shadow_rate: 0, table: {} },
      knowledge: { graph: false, generalization_probe: true },
      router: { candidates: ['generic', 'data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1 },
    },
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
    decision_layer: { model: 'jev-test', features: { edge_checks: 'enforce', request_routing: 'disabled', workflow_routing: 'disabled' } },
    ...overrides,
  }
}

const memory: any = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn() }

function baseEvents(overrides: Record<string, unknown> = {}): any {
  return { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn(), ...overrides }
}

// Every required-section header used by the generic and data playbooks
// across every stage, so `validateArtifact` always passes.
const KITCHEN_SINK = ['Files touched', 'Prior knowledge', 'Open questions', 'Plan', 'Risks', 'Query strategy', 'Design', 'Result', 'Verification', 'Reconciliation', 'Review']
  .map(h => `## ${h}\nok`).join('\n')

function fakeLoop(opts: { fail?: (stage: string, playbook: string) => boolean } = {}) {
  const calls: Array<{ stage: string; playbook: string; intensity: number; taskId: string; seed: string }> = []
  const loop = vi.fn(async (seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, o: any) => {
    calls.push({ stage: o.stage.stage, playbook: o.stage.playbook, intensity: o.stage.intensity, taskId: o.stage.task_id, seed })
    const body = opts.fail?.(o.stage.stage, o.stage.playbook) ? '## nothing\nempty' : KITCHEN_SINK
    staged.messages.push({ role: 'assistant', content: body })
  })
  return { loop, calls }
}

// Distinguishes the two prompt shapes runWorkflow's helper-model calls send
// through shadowCompletion when not fixed-triage: triageA's classify prompt
// and triageB's plan prompt (both fixed here, confidence 0.9), plus phase 4's
// stuck clarifying question prompt (spec §5.6, reused for edge checks).
function openaiFor(opts: { question?: string | Error } = {}): any {
  return {
    chat: {
      completions: {
        create: vi.fn(async (request: any) => {
          const content = request.messages[0].content as string
          if (content.includes('Classify')) return { choices: [{ message: { content: '{"task_class":"general","recon_intensity":1}' } }] }
          if (content.startsWith('Ask a single short clarifying question')) {
            if (opts.question instanceof Error) throw opts.question
            return { choices: [{ message: { content: opts.question ?? 'Could you clarify?' } }] }
          }
          return { choices: [{ message: { content: JSON.stringify({ task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 1, design: 0, build: 1, verify: 1, review: 0 }, confidence: 0.9, why: 'test' }) } }] }
        }),
      },
    },
  }
}

function success(answers: Record<string, any>): any {
  return { kind: 'success', response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
}

type EdgeAnswer = { next: 'continue' | 'promote' | 'reroute' | 'stuck' | 'done'; failed_back?: string; drift?: Record<string, number> }

// One mock DecisionProvider handling both the edge (`next`/`failed_back`
// questions) and route (`domain_*`/`scale` questions) shapes runWorkflow can
// send through it — distinguished by which questions are present, the same
// way tests/workflow-router-enforce.test.ts's openaiRouting distinguishes
// triage/clarify/plan prompts by content.
function combinedProvider(opts: { edge?: (state: any) => EdgeAnswer; route?: { domain?: Record<string, number>; ambiguous?: number } } = {}) {
  const evaluate = vi.fn(async (input: any) => {
    if (input.questions.next) {
      const answer = opts.edge ? opts.edge(input.state) : { next: 'continue' as const }
      const answers: Record<string, any> = {
        next: { type: 'choice', choice: answer.next, probabilities: { [answer.next]: 1 }, confidence: 0.9 },
        failed_back: { type: 'choice', choice: answer.failed_back ?? 'none', probabilities: { [answer.failed_back ?? 'none']: 1 }, confidence: 0.9 },
      }
      for (const key of Object.keys(input.questions)) {
        if (key.startsWith('drift_')) {
          const name = key.slice('drift_'.length)
          answers[key] = { type: 'noul', noul: answer.drift?.[name] ?? 0.1 }
        }
      }
      return success(answers)
    }
    const answers: Record<string, any> = {}
    for (const key of Object.keys(input.questions)) {
      if (key.startsWith('domain_')) answers[key] = { type: 'noul', noul: opts.route?.domain?.[key.slice('domain_'.length)] ?? 0.1 }
    }
    if (input.questions.scale) {
      const levels = ['trivial', 'small', 'medium', 'large']
      answers.scale = { type: 'score', score: 1, legend: Object.fromEntries(levels.map((_l, i) => [String(i), input.questions.scale.criteria[i]])), probabilities: { '0': 0.1, '1': 0.6, '2': 0.2, '3': 0.1 }, confidence: 0.8 }
    }
    if (input.questions.has_existing_work) answers.has_existing_work = { type: 'noul', noul: 0.4 }
    if (input.questions.ambiguous) answers.ambiguous = { type: 'noul', noul: opts.route?.ambiguous ?? 0.1 }
    if (input.questions.continues_previous) answers.continues_previous = { type: 'noul', noul: 0.1 }
    return success(answers)
  })
  return { evaluate }
}

function context(profileValue: any, session: any, decisionRuntime?: any, events?: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events: events ?? baseEvents(), openai: {}, delegateDepth: 0, decisionRuntime }
}

describe('runWorkflow edge checks + re-route (roadmap #31 phase 4, PT-079)', () => {
  it('hard signal present (contract failure): never calls the edge provider for that stage, takes today\'s escalation path', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile({ workflow: { ...profile().workflow, budget: { max_usd_per_task: 2, max_stage_retries: 0, max_stage_minutes: 15 } } })
    const provider = combinedProvider({ edge: () => ({ next: 'continue' }) })
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `hard-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop({ fail: stage => stage === 'build' })
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

    expect(provider.evaluate.mock.calls.some((call: any) => call[0].state?.stage === 'build')).toBe(false)
    expect(calls.some(c => c.stage === 'build')).toBe(true)
    const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
    expect(outcomeEvents[0].verdict).toBe('abandoned')
    expect(outcomeEvents[0].reason).toContain('stage contract unmet')
    expect(readTelemetryLines().some(e => e.kind === 'edge' && e.stage === 'build')).toBe(false)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('continue: same stage sequence as edge checks disabled, edge telemetry logged and applied', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const provider = combinedProvider({ edge: () => ({ next: 'continue' }) })
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `continue-${Math.random()}`)
    const events = baseEvents()
    const withEdge = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop: withEdge.loop })

    const disabledProfile = profile({ decision_layer: undefined })
    const session2 = createSession(disabledProfile.name, `continue-disabled-${Math.random()}`)
    const events2 = baseEvents()
    const withoutEdge = fakeLoop()
    await runWorkflow('bugfix', disabledProfile, session2, context(disabledProfile, session2), events2, openaiFor(), new AbortController().signal, { loop: withoutEdge.loop })

    expect(withEdge.calls.map(c => ({ stage: c.stage, intensity: c.intensity }))).toEqual(withoutEdge.calls.map(c => ({ stage: c.stage, intensity: c.intensity })))
    const edgeEvents = readTelemetryLines().filter(e => e.kind === 'edge')
    expect(edgeEvents.length).toBe(3) // plan, build, verify (recon excluded)
    expect(edgeEvents.every(e => e.edge_applied === true)).toBe(true)
    expect(edgeEvents.every(e => e.edge_jev === 'continue')).toBe(true)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('shadow mode: regex path taken regardless of the Jev verdict, agree/disagree logged, stage sequence unchanged', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile({ decision_layer: { model: 'jev-test', features: { edge_checks: 'shadow', request_routing: 'disabled', workflow_routing: 'disabled' } } })
    const provider = combinedProvider({ edge: () => ({ next: 'promote' }) }) // disagrees with the regex 'continue'
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `shadow-${Math.random()}`)
    const events = baseEvents()
    const withShadow = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop: withShadow.loop })

    const disabledProfile = profile({ decision_layer: undefined })
    const session2 = createSession(disabledProfile.name, `shadow-disabled-${Math.random()}`)
    const events2 = baseEvents()
    const withoutEdge = fakeLoop()
    await runWorkflow('bugfix', disabledProfile, session2, context(disabledProfile, session2), events2, openaiFor(), new AbortController().signal, { loop: withoutEdge.loop })

    expect(withShadow.calls.map(c => ({ stage: c.stage, intensity: c.intensity }))).toEqual(withoutEdge.calls.map(c => ({ stage: c.stage, intensity: c.intensity })))
    const edgeEvents = readTelemetryLines().filter(e => e.kind === 'edge')
    expect(edgeEvents.length).toBeGreaterThan(0)
    expect(edgeEvents.every(e => e.edge_applied === false)).toBe(true)
    expect(edgeEvents.every(e => e.edge_jev === 'promote')).toBe(true)
    expect(edgeEvents.every(e => e.edge_regex === 'continue')).toBe(true)
    expect(edgeEvents.every(e => e.edge_agree === false)).toBe(true)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('Jev failure (unavailable) falls back to the regex path, edge_fallback logged', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const provider = { evaluate: vi.fn(async () => ({ kind: 'unavailable' as const, reason: 'network_error' as const, retryable: true })) }
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `fail-${Math.random()}`)
    const events = baseEvents()
    const withFailure = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop: withFailure.loop })

    const disabledProfile = profile({ decision_layer: undefined })
    const session2 = createSession(disabledProfile.name, `fail-disabled-${Math.random()}`)
    const events2 = baseEvents()
    const withoutEdge = fakeLoop()
    await runWorkflow('bugfix', disabledProfile, session2, context(disabledProfile, session2), events2, openaiFor(), new AbortController().signal, { loop: withoutEdge.loop })

    expect(withFailure.calls.map(c => ({ stage: c.stage, intensity: c.intensity }))).toEqual(withoutEdge.calls.map(c => ({ stage: c.stage, intensity: c.intensity })))
    const edgeEvents = readTelemetryLines().filter(e => e.kind === 'edge')
    expect(edgeEvents.length).toBeGreaterThan(0)
    expect(edgeEvents.every(e => e.edge_fallback)).toBeTruthy()
    expect(edgeEvents.every(e => e.edge_applied === false)).toBe(true)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('failed_back takes precedence over next, even when next is continue', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    let sentFailback = false
    const provider = combinedProvider({
      edge: state => {
        if (state.stage === 'build' && !sentFailback) { sentFailback = true; return { next: 'continue', failed_back: 'plan' } }
        return { next: 'continue' }
      },
    })
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `failback-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

    const planCalls = calls.filter(c => c.stage === 'plan')
    expect(planCalls.length).toBe(2) // original + fail-back re-run
    const buildCalls = calls.filter(c => c.stage === 'build')
    expect(buildCalls.length).toBe(2) // original + re-run after the fail-back replays plan
    const edgeEvents = readTelemetryLines().filter(e => e.kind === 'edge')
    expect(edgeEvents.some(e => e.edge_jev === 'failback:plan')).toBe(true)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('promote: raises plan/verify intensity and restarts at plan (fallback +1, no routed scale)', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    let promoted = false
    const provider = combinedProvider({
      edge: state => {
        if (state.stage === 'plan' && !promoted) { promoted = true; return { next: 'promote' } }
        return { next: 'continue' }
      },
    })
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `promote-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

    const planCalls = calls.filter(c => c.stage === 'plan')
    expect(planCalls.length).toBe(2)
    expect(planCalls[0].intensity).toBe(1)
    expect(planCalls[1].intensity).toBe(2)
    const verifyCalls = calls.filter(c => c.stage === 'verify')
    expect(verifyCalls.length).toBe(1)
    expect(verifyCalls[0].intensity).toBe(2)
    const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
    expect(outcomeEvents[0].verdict).toBe('accepted')
    expect(outcomeEvents[0].rework_count).toBeGreaterThanOrEqual(1)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  describe('stuck', () => {
    it('asks a clarifying question (sharing the route-ask counter) and retries the stage', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      let sentStuck = false
      const provider = combinedProvider({
        edge: state => {
          if (state.stage === 'build' && !sentStuck) { sentStuck = true; return { next: 'stuck' } }
          return { next: 'continue' }
        },
      })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `stuck-ask-${Math.random()}`)
      const onInputRequest = vi.fn().mockResolvedValue('use the staging DB')
      const events = baseEvents({ onInputRequest })
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor({ question: 'Which database?' }), new AbortController().signal, { loop })

      expect(onInputRequest).toHaveBeenCalledTimes(1)
      expect(onInputRequest.mock.calls[0][1]).toBe('Which database?')
      const buildCalls = calls.filter(c => c.stage === 'build')
      expect(buildCalls.length).toBe(2)
      expect(buildCalls[1].seed).toContain('Clarification: use the staging DB')
      const clarifyEvents = readTelemetryLines().filter(e => e.kind === 'clarify')
      expect(clarifyEvents.length).toBe(1)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('no onInputRequest: takes the existing abandon path', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const provider = combinedProvider({ edge: state => (state.stage === 'build' ? { next: 'stuck' } : { next: 'continue' }) })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `stuck-unattended-${Math.random()}`)
      const events = baseEvents() // no onInputRequest
      const { loop } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
      expect(outcomeEvents[0].verdict).toBe('abandoned')
      expect(outcomeEvents[0].reason).toContain('stuck')
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('clarifications already exhausted (max_clarifications: 0): takes the abandon path without asking', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({ workflow: { ...profile().workflow, router: { candidates: ['generic', 'data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 0 } } })
      const provider = combinedProvider({ edge: state => (state.stage === 'build' ? { next: 'stuck' } : { next: 'continue' }) })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `stuck-nocap-${Math.random()}`)
      const onInputRequest = vi.fn().mockResolvedValue('answer')
      const events = baseEvents({ onInputRequest })
      const { loop } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      expect(onInputRequest).not.toHaveBeenCalled()
      const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
      expect(outcomeEvents[0].verdict).toBe('abandoned')
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })
  })

  describe('done', () => {
    it('jumps to verify when it has not run yet and its intensity > 0', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const provider = combinedProvider({ edge: state => (state.stage === 'plan' ? { next: 'done' } : { next: 'continue' }) })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `done-jump-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      expect(calls.map(c => c.stage)).toEqual(['recon', 'plan', 'verify'])
      const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
      expect(outcomeEvents[0].verdict).toBe('accepted')
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('finishes the pass when no later verify stage remains (triggered at verify itself)', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const provider = combinedProvider({ edge: state => (state.stage === 'verify' ? { next: 'done' } : { next: 'continue' }) })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `done-finish-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      expect(calls.map(c => c.stage)).toEqual(['recon', 'plan', 'build', 'verify'])
      const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
      expect(outcomeEvents[0].verdict).toBe('accepted')
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })
  })

  describe('reroute', () => {
    function reroutingProfile(overrides: Record<string, unknown> = {}) {
      return profile({
        decision_layer: { model: 'jev-test', features: { edge_checks: 'enforce', request_routing: 'enforce', workflow_routing: 'disabled' } },
        ...overrides,
      })
    }

    it('allowed: skips recon in the new pass, new task id, parent link, session route records the delivering playbook', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = reroutingProfile()
      const provider = combinedProvider({
        edge: state => (state.stage === 'build' && state.playbook === 'generic' ? { next: 'reroute', drift: { data: 0.9 } } : { next: 'continue' }),
        route: { domain: { generic: 0.9, data: 0.1 } },
      })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `reroute-ok-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      const genericCalls = calls.filter(c => c.playbook === 'generic')
      const dataCalls = calls.filter(c => c.playbook === 'data')
      expect(genericCalls.map(c => c.stage)).toEqual(['recon', 'plan', 'build'])
      // The new pass on 'data' never re-runs recon.
      expect(dataCalls.some(c => c.stage === 'recon')).toBe(false)
      expect(dataCalls.length).toBeGreaterThan(0)
      expect(dataCalls[0].stage).toBe('plan')

      const dataTaskId = dataCalls[0].taskId
      const genericTaskId = genericCalls[0].taskId
      expect(dataTaskId).not.toBe(genericTaskId)

      const rerouteEvents = readTelemetryLines().filter(e => e.kind === 'reroute')
      expect(rerouteEvents.length).toBe(1)
      expect(rerouteEvents[0].parent_task_id).toBe(genericTaskId)
      expect(rerouteEvents[0].route_playbooks).toEqual(['data'])

      expect(session.workflow_route!.playbook).toBe('data')
      expect(session.messages.filter((m: any) => m.role === 'user').length).toBe(1)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('allowed reroute records an abandoned outcome for the rerouted-away task', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = reroutingProfile()
      const provider = combinedProvider({
        edge: state => (state.stage === 'build' && state.playbook === 'generic' ? { next: 'reroute', drift: { data: 0.9 } } : { next: 'continue' }),
        route: { domain: { generic: 0.9, data: 0.1 } },
      })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `reroute-outcome-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      const genericTaskId = calls.find(c => c.playbook === 'generic')!.taskId
      const outcome = readTelemetryLines().find(e => e.kind === 'outcome' && e.task_id === genericTaskId && !e.explore)
      expect(outcome?.verdict).toBe('abandoned')
      expect(outcome?.reason).toContain('rerouted to data')
    })

    it('secondary multi-domain pass cannot reroute: it runs to completion instead of being cut short', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = reroutingProfile()
      const provider = combinedProvider({
        edge: state => (state.stage === 'build' && state.playbook === 'data' ? { next: 'reroute', drift: { generic: 0.9 } } : { next: 'continue' }),
        route: { domain: { generic: 0.9, data: 0.6 } },
      })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `secondary-no-reroute-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('cross-cutting change', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      const dataCalls = calls.filter(c => c.playbook === 'data')
      expect(dataCalls.map(c => c.stage)).toContain('verify')
      const dataTaskId = dataCalls[0].taskId
      const outcome = readTelemetryLines().find(e => e.kind === 'outcome' && e.task_id === dataTaskId && !e.explore)
      expect(outcome?.verdict).toBe('accepted')
      expect(readTelemetryLines().some(e => e.kind === 'reroute')).toBe(false)
      expect(session.messages.filter((m: any) => m.role === 'assistant').length).toBe(2)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('cap reached (max_reroutes: 0): treated as continue', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = reroutingProfile({ workflow: { ...profile().workflow, router: { candidates: ['generic', 'data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 0, max_clarifications: 1 } } })
      const provider = combinedProvider({
        edge: state => (state.stage === 'build' ? { next: 'reroute', drift: { data: 0.9 } } : { next: 'continue' }),
        route: { domain: { generic: 0.9, data: 0.1 } },
      })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `reroute-cap-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      expect(calls.every(c => c.playbook === 'generic')).toBe(true)
      expect(readTelemetryLines().some(e => e.kind === 'reroute')).toBe(false)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('request_routing not enforce: treated as continue', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({ decision_layer: { model: 'jev-test', features: { edge_checks: 'enforce', request_routing: 'shadow', workflow_routing: 'disabled' } } })
      const provider = combinedProvider({
        edge: state => (state.stage === 'build' ? { next: 'reroute', drift: { data: 0.9 } } : { next: 'continue' }),
        route: { domain: { generic: 0.9, data: 0.1 } },
      })
      const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
      const session = createSession(p.name, `reroute-notenforce-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

      expect(calls.every(c => c.playbook === 'generic')).toBe(true)
      expect(readTelemetryLines().some(e => e.kind === 'reroute')).toBe(false)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })
  })

  it('recon never skipped for the first pass, even with edge checks enforced', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const provider = combinedProvider({ edge: () => ({ next: 'continue' }) })
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `recon-gate-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })
    expect(calls[0].stage).toBe('recon')
  })

  it('edge telemetry never contains raw artifact or request text', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const provider = combinedProvider({ edge: () => ({ next: 'continue' }) })
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `edge-no-text-${Math.random()}`)
    const events = baseEvents()
    const { loop } = fakeLoop()
    const request = 'a very distinctive secret request marker XKCD9182'
    await runWorkflow(request, p, session, context(p, session, runtime, events), events, openaiFor(), new AbortController().signal, { loop })

    const edgeEvents = readTelemetryLines().filter(e => e.kind === 'edge')
    expect(edgeEvents.length).toBeGreaterThan(0)
    for (const event of edgeEvents) {
      const serialized = JSON.stringify(event)
      expect(serialized).not.toContain('XKCD9182')
      expect(serialized).not.toContain(KITCHEN_SINK)
      expect(serialized).not.toContain('Files touched')
    }
  })
})
