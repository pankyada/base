import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runWorkflow, FIXED_CLARIFYING_QUESTION } from '../src/workflow/runner.js'
import { DecisionRuntimeService } from '../src/decisions/runtime.js'
import { telemetryFilePath } from '../src/telemetry/logger.js'
import { readFileSync, existsSync, rmSync } from 'fs'

// Roadmap #31 phase 3 (PT-078), spec §6 "Phase 3". Enforce mode applying a
// RouteDecision: routed playbook replaces the profile playbook, intensity
// floor merges in, ask-user clarification (§5.6), session route memory
// (§5.5), and sequential multi-domain passes (§5.3). Shares the fake-loop /
// mock-decision-provider runtime-test style of tests/workflow-router-runtime.test.ts
// (phase 2).

function readTelemetryLines(): any[] {
  if (!existsSync(telemetryFilePath())) return []
  return readFileSync(telemetryFilePath(), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'coding',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-router-enforce-tests',
    working_dir: process.cwd(),
    workflow: {
      enabled: true, playbook: 'coding',
      min_intensity: { recon: 1 }, max_intensity: {},
      budget: { max_usd_per_task: 2, max_stage_retries: 2, max_stage_minutes: 15 },
      routing: { policy: 'static', explore_rate: 0, shadow_rate: 0, table: {} },
      knowledge: { graph: false, generalization_probe: true },
      router: { candidates: ['coding', 'data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1 },
    },
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
    decision_layer: { model: 'jev-test', features: { request_routing: 'enforce', workflow_routing: 'disabled' } },
    ...overrides,
  }
}

const memory: any = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn() }

function baseEvents(overrides: Record<string, unknown> = {}): any {
  return { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn(), ...overrides }
}

// A body containing every required-section header used by the generic,
// coding, and data playbooks (across all stages/levels touched by these
// tests), so `validateArtifact` always passes regardless of which playbook
// is actually routed to — the tests assert routing via telemetry/seed
// content, not via engineered contract failures (except where a test
// deliberately wants recon to fail the contract).
const KITCHEN_SINK = ['Files touched', 'Prior knowledge', 'Open questions', 'Plan', 'Query strategy', 'Risks', 'Design', 'Metrics', 'Join keys', 'Result', 'Verification', 'Reconciliation', 'Review', 'Generalization', 'Callers', 'Existing tests']
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

// Distinguishes the three prompt shapes runWorkflow's helper-model calls can
// send through shadowCompletion: triageA's classify prompt, the clarifying
// question prompt (spec §5.6, cheap-role model), and triageB's plan prompt.
function openaiRouting(opts: { question?: string | Error } = {}): any {
  return {
    chat: {
      completions: {
        create: vi.fn(async (request: any) => {
          const content = request.messages[0].content as string
          if (content.includes('Classify')) return { choices: [{ message: { content: '{"task_class":"bugfix","recon_intensity":1}' } }] }
          if (content.startsWith('Ask a single short clarifying question')) {
            if (opts.question instanceof Error) throw opts.question
            return { choices: [{ message: { content: opts.question ?? 'What exactly should change?' } }] }
          }
          return { choices: [{ message: { content: JSON.stringify({ task_class: 'bugfix', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 1, design: 0, build: 1, verify: 1, review: 0 }, confidence: 0.9, why: 'test' }) } }] }
        }),
      },
    },
  }
}

function routeProvider(opts: { domain?: Record<string, number>; scaleProbs?: Record<string, number>; ambiguous?: number; continuesPrevious?: number } = {}) {
  return {
    evaluate: vi.fn(async (input: any) => {
      const answers: Record<string, any> = {}
      for (const key of Object.keys(input.questions)) {
        if (key.startsWith('domain_')) {
          const name = key.slice('domain_'.length)
          answers[key] = { type: 'noul', noul: opts.domain?.[name] ?? 0.1 }
        }
      }
      const levels = ['trivial', 'small', 'medium', 'large']
      const probs = opts.scaleProbs ?? { trivial: 0.1, small: 0.6, medium: 0.2, large: 0.1 }
      answers.scale = {
        type: 'score', score: 1,
        legend: Object.fromEntries(levels.map((_l, i) => [String(i), input.questions.scale.criteria[i]])),
        probabilities: Object.fromEntries(levels.map((l, i) => [String(i), probs[l]])),
        confidence: 0.8,
      }
      answers.has_existing_work = { type: 'noul', noul: 0.4 }
      answers.ambiguous = { type: 'noul', noul: opts.ambiguous ?? 0.2 }
      if (input.questions.continues_previous) answers.continues_previous = { type: 'noul', noul: opts.continuesPrevious ?? 0.1 }
      return { kind: 'success' as const, response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
    }),
  }
}

function context(profileValue: any, session: any, decisionRuntime?: any, events?: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events: events ?? baseEvents(), openai: {}, delegateDepth: 0, decisionRuntime }
}

describe('runWorkflow enforce routing (roadmap #31 phase 3, PT-078)', () => {
  it('enforce + run: stages use the routed playbook, not the profile playbook', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.1, data: 0.9 } }), model: 'jev-test' })
    const session = createSession(p.name, `enforce-routed-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('reconcile the ledger totals', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

    // Routed to 'data', not the profile's 'coding' playbook.
    expect(calls.every(c => c.playbook === 'data')).toBe(true)
    expect(calls.some(c => c.playbook === 'coding')).toBe(false)

    // The plan-stage seed carries data's contract (`Query strategy` is
    // unique to data's plan contract; coding's plan contract lacks it).
    const planCall = calls.find(c => c.stage === 'plan')
    expect(planCall?.seed).toContain('Query strategy')

    const stageEvents = readTelemetryLines().filter(e => e.kind === 'stage' && e.state === 'start')
    expect(stageEvents.every(e => e.playbook === 'data')).toBe(true)

    const routeEvents = readTelemetryLines().filter(e => e.kind === 'route')
    expect(routeEvents.length).toBe(1)
    expect(routeEvents[0].route_applied).toBe(true)
    expect(routeEvents[0].route_mode).toBe('enforce')
  })

  it('Jev failure in enforce falls back to the profile playbook (today\'s path)', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const runtime = new DecisionRuntimeService({ provider: { evaluate: async () => ({ kind: 'unavailable', reason: 'network_error', retryable: true }) }, model: 'jev-test' })
    const session = createSession(p.name, `enforce-fallback-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('fix the crash', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

    expect(calls.every(c => c.playbook === 'coding')).toBe(true)
    const [routeEvent] = readTelemetryLines().filter(e => e.kind === 'route')
    expect(routeEvent.route_fallback).toBeDefined()
    expect(routeEvent.route_applied).toBe(false)
  })

  describe('intensity floor merge', () => {
    it('floor raises an unconstrained stage intensity', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({
        workflow: {
          ...profile().workflow,
          playbook: 'generic',
          max_intensity: {},
          router: { candidates: ['coding', 'generic'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1, scale_presets: { medium: { plan: 2, design: 0, verify: 1, review: 0 } } },
        },
      })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.1, generic: 0.9 }, scaleProbs: { trivial: 0.05, small: 0.1, medium: 0.75, large: 0.1 } }), model: 'jev-test' })
      const session = createSession(p.name, `floor-raise-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('generic task', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      const planCall = calls.find(c => c.stage === 'plan')
      // generic's own default plan intensity is 1; the medium preset floor is 2.
      expect(planCall?.intensity).toBe(2)
    })

    it('profile max_intensity still caps the floor (fixed-triage path too)', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const fixed = { recon: 1, plan: 1, design: 0, build: 1, verify: 1, review: 0 }
      const p = profile({
        workflow: {
          ...profile().workflow,
          min_intensity: fixed, max_intensity: fixed,
          router: { candidates: ['coding', 'data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1, scale_presets: { medium: { plan: 2, design: 1, verify: 2, review: 1 } } },
        },
      })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 }, scaleProbs: { trivial: 0.05, small: 0.1, medium: 0.75, large: 0.1 } }), model: 'jev-test' })
      const session = createSession(p.name, `floor-capped-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      const planCall = calls.find(c => c.stage === 'plan')
      // Floor tries to raise plan to 2, but min===max===1 pins it back to 1.
      expect(planCall?.intensity).toBe(1)
    })

    it('recon stays >= 1 even when profile max_intensity.recon is 0', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({ workflow: { ...profile().workflow, max_intensity: { recon: 0 } } })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 } }), model: 'jev-test' })
      const session = createSession(p.name, `floor-recon-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      const reconCall = calls.find(c => c.stage === 'recon')
      expect(reconCall?.intensity).toBeGreaterThanOrEqual(1)
    })
  })

  describe('ask user (spec §5.6)', () => {
    it('asks once via the cheap-model question, re-routes with a Clarification suffix, then proceeds', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 }, ambiguous: 0.9 }), model: 'jev-test' })
      const session = createSession(p.name, `ask-once-${Math.random()}`)
      const onInputRequest = vi.fn().mockResolvedValue('it means the login button')
      const events = baseEvents({ onInputRequest })
      const { loop, calls } = fakeLoop()
      await runWorkflow('fix it', p, session, context(p, session, runtime, events), events, openaiRouting({ question: 'Which button is broken?' }), new AbortController().signal, { loop })

      expect(onInputRequest).toHaveBeenCalledTimes(1)
      expect(onInputRequest.mock.calls[0][1]).toBe('Which button is broken?')
      expect(onInputRequest.mock.calls[0][2]).toBe('text')
      expect(calls.length).toBeGreaterThan(0)

      const firstSeed = calls[0].seed
      expect(firstSeed).toContain('Clarification: it means the login button')

      const clarifyEvents = readTelemetryLines().filter(e => e.kind === 'clarify')
      expect(clarifyEvents.length).toBe(1)
      expect(clarifyEvents[0].task_id).toBeDefined()
      expect(clarifyEvents[0].attempt).toBe(1)
      const serialized = JSON.stringify(clarifyEvents[0])
      expect(serialized).not.toContain('Which button is broken?')
      expect(serialized).not.toContain('it means the login button')

      const routeEvents = readTelemetryLines().filter(e => e.kind === 'route')
      expect(routeEvents.length).toBe(2) // one per resolution attempt
    })

    it('cheap-model question failure falls back to the fixed generic question', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 }, ambiguous: 0.9 }), model: 'jev-test' })
      const session = createSession(p.name, `ask-fallback-${Math.random()}`)
      const onInputRequest = vi.fn().mockResolvedValue('some answer')
      const events = baseEvents({ onInputRequest })
      const { loop } = fakeLoop()
      await runWorkflow('fix it', p, session, context(p, session, runtime, events), events, openaiRouting({ question: new Error('cheap model unavailable') }), new AbortController().signal, { loop })

      expect(onInputRequest).toHaveBeenCalledTimes(1)
      expect(onInputRequest.mock.calls[0][1]).toBe(FIXED_CLARIFYING_QUESTION)
    })

    it('caps asks at max_clarifications, then proceeds with a run decision', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({
        workflow: { ...profile().workflow, router: { candidates: ['coding', 'data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 2 } },
      })
      // Jev always says ambiguous, regardless of the clarification appended.
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 }, ambiguous: 0.95 }), model: 'jev-test' })
      const session = createSession(p.name, `ask-cap-${Math.random()}`)
      const onInputRequest = vi.fn().mockResolvedValue('still vague')
      const events = baseEvents({ onInputRequest })
      const { loop, calls } = fakeLoop()
      await runWorkflow('fix it', p, session, context(p, session, runtime, events), events, openaiRouting({ question: 'Can you say more?' }), new AbortController().signal, { loop })

      expect(onInputRequest).toHaveBeenCalledTimes(2)
      expect(calls.length).toBeGreaterThan(0) // it proceeded to run stages, not stuck asking forever
      const clarifyEvents = readTelemetryLines().filter(e => e.kind === 'clarify')
      expect(clarifyEvents.map(e => e.attempt)).toEqual([1, 2])
    })

    it('unattended (no onInputRequest): never asks, proceeds with a run decision', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 }, ambiguous: 0.9 }), model: 'jev-test' })
      const session = createSession(p.name, `ask-unattended-${Math.random()}`)
      const events = baseEvents() // no onInputRequest
      const { loop, calls } = fakeLoop()
      await runWorkflow('fix it', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      expect(calls.length).toBeGreaterThan(0)
      expect(calls.every(c => c.playbook === 'coding')).toBe(true)
      const clarifyEvents = readTelemetryLines().filter(e => e.kind === 'clarify')
      expect(clarifyEvents.length).toBe(0)
    })
  })

  describe('multi-domain (spec §5.3)', () => {
    it('runs two passes in order, chains the primary artifact, links task_ids, pushes the user message once, and ends the session once', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.6 } }), model: 'jev-test' })
      const session = createSession(p.name, `multi-domain-${Math.random()}`)
      const observations: any[] = []
      const events = baseEvents({ onWorkflowMap: (value: any) => observations.push(value) })
      const { loop, calls } = fakeLoop()
      const runContext = context(p, session, runtime, events)
      runContext.runId = 'run-map-sequential-pass'
      await runWorkflow('cross-cutting change', p, session, runContext, events, openaiRouting(), new AbortController().signal, { loop })

      const codingIdx = calls.map((c, i) => (c.playbook === 'coding' ? i : -1)).filter(i => i >= 0)
      const dataIdx = calls.map((c, i) => (c.playbook === 'data' ? i : -1)).filter(i => i >= 0)
      expect(codingIdx.length).toBeGreaterThan(0)
      expect(dataIdx.length).toBeGreaterThan(0)
      expect(Math.max(...codingIdx)).toBeLessThan(Math.min(...dataIdx))

      const primaryTaskId = calls[codingIdx[0]].taskId
      const secondaryTaskId = calls[dataIdx[0]].taskId
      expect(secondaryTaskId).not.toBe(primaryTaskId)

      // Secondary recon sees the primary's final artifact as prior context.
      const secondaryFirstSeed = calls[dataIdx[0]].seed
      expect(secondaryFirstSeed).toContain('Result')

      const stageEvents = readTelemetryLines().filter(e => e.kind === 'stage')
      const secondaryStageEvents = stageEvents.filter(e => e.task_id === secondaryTaskId)
      expect(secondaryStageEvents.length).toBeGreaterThan(0)
      expect(secondaryStageEvents.every(e => e.parent_task_id === primaryTaskId)).toBe(true)
      const primaryStageEvents = stageEvents.filter(e => e.task_id === primaryTaskId)
      expect(primaryStageEvents.every(e => e.parent_task_id === undefined)).toBe(true)

      const mapAttempts = observations.filter(value => value.kind === 'attempt_started').map(value => value.attempt)
      const primaryMapAttempt = mapAttempts.filter((attempt: any) => attempt.pass_id === primaryTaskId).at(-1)
      const secondaryMapAttempt = mapAttempts.find((attempt: any) => attempt.pass_id === secondaryTaskId)
      expect(secondaryMapAttempt.parent_pass_id).toBe(primaryTaskId)
      expect(observations.some(value => value.kind === 'transition' && value.transition.from_attempt_id === primaryMapAttempt.attempt_id && value.transition.to_attempt_id === secondaryMapAttempt.attempt_id)).toBe(true)

      expect(session.messages.filter((m: any) => m.role === 'user').length).toBe(1)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('primary abandoned: secondary is skipped, onSessionEnd still fires exactly once', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({ workflow: { ...profile().workflow, budget: { max_usd_per_task: 2, max_stage_retries: 0, max_stage_minutes: 15 } } })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.6 } }), model: 'jev-test' })
      const session = createSession(p.name, `multi-domain-abandon-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop({ fail: stage => stage === 'recon' })
      await runWorkflow('cross-cutting change', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      expect(calls.every(c => c.playbook === 'coding')).toBe(true)
      expect(calls.some(c => c.playbook === 'data')).toBe(false)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
      expect(session.workflow_route).toBeUndefined()
    })
  })

  describe('session route memory (spec §5.5)', () => {
    it('writes the session route on an accepted run decision (enforce)', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 } }), model: 'jev-test' })
      const session = createSession(p.name, `route-memory-enforce-${Math.random()}`)
      const events = baseEvents()
      const { loop } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      expect(session.workflow_route).toBeDefined()
      expect(session.workflow_route!.playbook).toBe('coding')
      expect(session.workflow_route!.scale).toBeDefined()
      expect(session.workflow_route!.task_id).toBeDefined()
      expect(session.workflow_route!.at).toBeDefined()
    })

    it('writes the session route in shadow mode too (logged, not applied)', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({ decision_layer: { model: 'jev-test', features: { request_routing: 'shadow', workflow_routing: 'disabled' } } })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.1, data: 0.9 } }), model: 'jev-test' })
      const session = createSession(p.name, `route-memory-shadow-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      // Shadow never applies the decision: stages still ran on the profile's playbook.
      expect(calls.every(c => c.playbook === 'coding')).toBe(true)
      // But the session route is still recorded — feeds continues_previous next time.
      expect(session.workflow_route).toBeDefined()
      expect(session.workflow_route!.playbook).toBe('data')
    })

    it('does not write the session route on an abandoned outcome', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({ workflow: { ...profile().workflow, budget: { max_usd_per_task: 2, max_stage_retries: 0, max_stage_minutes: 15 } } })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 } }), model: 'jev-test' })
      const session = createSession(p.name, `route-memory-abandon-${Math.random()}`)
      const events = baseEvents()
      const { loop } = fakeLoop({ fail: stage => stage === 'recon' })
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      expect(session.workflow_route).toBeUndefined()
    })

    it('a follow-up request reuses the session route playbook in enforce mode (continues_previous)', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const session = createSession(p.name, `route-memory-followup-${Math.random()}`)
      const events = baseEvents()

      // First task: routes to 'data'.
      const runtime1 = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.1, data: 0.9 } }), model: 'jev-test' })
      const first = fakeLoop()
      await runWorkflow('reconcile totals', p, session, context(p, session, runtime1, events), events, openaiRouting(), new AbortController().signal, { loop: first.loop })
      expect(session.workflow_route!.playbook).toBe('data')

      // Second task: a vague follow-up that Jev marks as continuing the previous task.
      rmSync(telemetryFilePath(), { force: true })
      const runtime2 = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 }, continuesPrevious: 0.9 }), model: 'jev-test' })
      const second = fakeLoop()
      await runWorkflow('also check the other one', p, session, context(p, session, runtime2, events), events, openaiRouting(), new AbortController().signal, { loop: second.loop })

      // Reused 'data' (the session route), not 'coding' (the domain-highest candidate this time).
      expect(second.calls.every(c => c.playbook === 'data')).toBe(true)
    })
  })

  describe('phase 2 parity', () => {
    it('shadow mode: stage sequence and playbook are identical to routing disabled', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const shadowProfile = profile({ decision_layer: { model: 'jev-test', features: { request_routing: 'shadow', workflow_routing: 'disabled' } } })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.1, data: 0.9 } }), model: 'jev-test' })
      const session1 = createSession(shadowProfile.name, `parity-shadow-${Math.random()}`)
      const events1 = baseEvents()
      const withRouting = fakeLoop()
      await runWorkflow('bugfix', shadowProfile, session1, context(shadowProfile, session1, runtime, events1), events1, openaiRouting(), new AbortController().signal, { loop: withRouting.loop })

      const disabledProfile = profile({ decision_layer: undefined })
      const session2 = createSession(disabledProfile.name, `parity-disabled-${Math.random()}`)
      const events2 = baseEvents()
      const withoutRouting = fakeLoop()
      await runWorkflow('bugfix', disabledProfile, session2, context(disabledProfile, session2), events2, openaiRouting(), new AbortController().signal, { loop: withoutRouting.loop })

      expect(withRouting.calls.map(c => ({ stage: c.stage, playbook: c.playbook, intensity: c.intensity }))).toEqual(
        withoutRouting.calls.map(c => ({ stage: c.stage, playbook: c.playbook, intensity: c.intensity })),
      )
    })

    it('router absent: byte-identical, no route/clarify telemetry', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({ workflow: { ...profile().workflow, router: undefined } })
      const evaluate = vi.fn()
      const runtime = new DecisionRuntimeService({ provider: { evaluate }, model: 'jev-test' })
      const session = createSession(p.name, `router-absent-${Math.random()}`)
      const events = baseEvents()
      const { loop } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })

      expect(evaluate).not.toHaveBeenCalled()
      expect(readTelemetryLines().some(e => e.kind === 'route' || e.kind === 'clarify')).toBe(false)
      expect(session.workflow_route).toBeUndefined()
    })
  })

  describe('review regressions (parent review of PT-078)', () => {
    it('aborted run does not fire onSessionEnd (pre-phase-3 parity)', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 } }), model: 'jev-test' })
      const session = createSession(p.name, `abort-${Math.random()}`)
      const events = baseEvents()
      const { loop } = fakeLoop()
      const abort = new AbortController()
      abort.abort()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), abort.signal, { loop })
      expect(events.onSessionEnd).not.toHaveBeenCalled()
    })

    it('secondary pass budget exhaustion ends the session exactly once (the fallback loop already ends it)', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile()
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.6 } }), model: 'jev-test' })
      const session = createSession(p.name, `secondary-budget-${Math.random()}`)
      const events = baseEvents()
      const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, ev: any, _openai: any, _signal: any, o: any) => {
        // plainFallback runs the flat loop with no stage tag; the real agent loop ends the session itself.
        if (!o?.stage) { ev.onSessionEnd(staged.id); return }
        staged.messages.push({ role: 'assistant', content: KITCHEN_SINK })
        if (o.stage.playbook === 'coding' && o.stage.stage === 'verify') staged.usage.cost_usd = 10
      })
      await runWorkflow('cross-cutting change', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })
      expect(loop.mock.calls.some(call => !call[7]?.stage)).toBe(true)
      expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
    })

    it('profile max_intensity.recon caps a routed recon floor', async () => {
      rmSync(telemetryFilePath(), { force: true })
      const p = profile({
        workflow: {
          ...profile().workflow,
          max_intensity: { recon: 1 },
          router: { candidates: ['coding', 'data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1, scale_presets: { large: { recon: 3 } } },
        },
      })
      const runtime = new DecisionRuntimeService({ provider: routeProvider({ domain: { coding: 0.9, data: 0.1 }, scaleProbs: { trivial: 0.05, small: 0.05, medium: 0.1, large: 0.8 } }), model: 'jev-test' })
      const session = createSession(p.name, `recon-cap-${Math.random()}`)
      const events = baseEvents()
      const { loop, calls } = fakeLoop()
      await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiRouting(), new AbortController().signal, { loop })
      expect(calls.find(c => c.stage === 'recon')?.intensity).toBe(1)
    })
  })
})
