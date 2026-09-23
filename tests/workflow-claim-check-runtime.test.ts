import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runWorkflow } from '../src/workflow/runner.js'
import { DecisionRuntimeService } from '../src/decisions/runtime.js'
import { telemetryFilePath } from '../src/telemetry/logger.js'
import { readFileSync, existsSync, rmSync } from 'fs'

// Roadmap #31 phase 5 (PT-080), spec §5.7/§6 "Phase 5". Runtime wiring of the
// verify claim-check hook through `runWorkflow`/`runWorkflowPass`. Shares the
// fake-loop / mock-decision-provider runtime-test style of
// tests/workflow-router-enforce.test.ts (phase 3). Pure extraction/evidence/
// gate-policy tests live in tests/workflow-claim-extract.test.ts; the Jev
// call layer's own tests live in tests/decisions-check-claims.test.ts.

function readTelemetryLines(): any[] {
  if (!existsSync(telemetryFilePath())) return []
  return readFileSync(telemetryFilePath(), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

const HEADERS = [
  'Files touched', 'Prior knowledge', 'Open questions', 'Callers', 'Existing tests', 'Git archaeology', 'Contradictions',
  'Plan', 'Files', 'Risks', 'Rollback', 'Alternatives', 'Tradeoffs',
  'Design', 'Interfaces', 'Schema', 'Migration', 'Contract tests', 'Backout',
  'Result', 'Invariants', 'Green checkpoints',
  'Verification', 'Changed branches', 'Adversarial cases', 'Edge cases',
  'Review', 'Findings', 'Security pass', 'Generalization',
]
// A checkable claim (number + file-like path + assertion verb "passed") on
// every stage body, so the final artifact always yields exactly one claim
// regardless of which stage ends up last (review, or build when verify is
// skipped for the "no verify stage" test).
const CLAIM_SENTENCE = 'The build ran 12 tests and all passed successfully in src/index.ts.'
const KITCHEN_SINK = `${HEADERS.map(h => `## ${h}\nok`).join('\n')}\n\n${CLAIM_SENTENCE}`

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'coding',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-claim-check-tests',
    working_dir: process.cwd(),
    workflow: {
      enabled: true, playbook: 'coding',
      min_intensity: { recon: 1 }, max_intensity: {},
      budget: { max_usd_per_task: 2, max_stage_retries: 2, max_stage_minutes: 15 },
      routing: { policy: 'static', explore_rate: 0, shadow_rate: 0, table: {} },
      knowledge: { graph: false, generalization_probe: true },
    },
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
    decision_layer: { model: 'jev-test', features: { claim_check: 'enforce', workflow_routing: 'disabled' } },
    ...overrides,
  }
}

const memory: any = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn() }

function baseEvents(overrides: Record<string, unknown> = {}): any {
  return { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn(), ...overrides }
}

function context(profileValue: any, session: any, decisionRuntime?: any, events?: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events: events ?? baseEvents(), openai: {}, delegateDepth: 0, decisionRuntime }
}

function fakeLoop(opts: { withTools?: boolean } = {}) {
  const calls: Array<{ stage: string; playbook: string; taskId: string; seed: string }> = []
  const loop = vi.fn(async (seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, o: any) => {
    calls.push({ stage: o?.stage?.stage, playbook: o?.stage?.playbook, taskId: o?.stage?.task_id, seed })
    staged.messages.push({ role: 'assistant', content: KITCHEN_SINK })
    if (opts.withTools !== false) staged.tool_calls.push({ name: 'Bash', input: {}, result: 'exit 0, 12 tests passed', ok: true, ts: new Date().toISOString() })
  })
  return { loop, calls }
}

function openaiFixed(intensity: Record<string, number> = { recon: 1, plan: 1, design: 1, build: 1, verify: 1, review: 1 }): any {
  return {
    chat: {
      completions: {
        create: vi.fn(async (request: any) => {
          const content = request.messages[0].content as string
          if (content.includes('Classify')) return { choices: [{ message: { content: '{"task_class":"bugfix","recon_intensity":1}' } }] }
          return { choices: [{ message: { content: JSON.stringify({ task_class: 'bugfix', blast_radius: 'module', reversibility: 'easy', intensity, confidence: 0.9, why: 'test' }) } }] }
        }),
      },
    },
  }
}

function success(answers: Record<string, any>): any {
  return { kind: 'success', response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
}

function claimsProvider(opts: { sequence?: number[]; malformed?: boolean; controlReason?: string; throwError?: Error } = {}) {
  let callIndex = 0
  const evaluate = vi.fn(async (input: any) => {
    if (opts.throwError) throw opts.throwError
    if (opts.controlReason) return { kind: 'control', reason: opts.controlReason }
    if (opts.malformed) return success({})
    const sequence = opts.sequence ?? [0.9]
    const p = sequence[Math.min(callIndex, sequence.length - 1)]
    callIndex++
    const answers: Record<string, any> = {}
    for (const key of Object.keys(input.questions)) answers[key] = { type: 'noul', noul: p }
    return success(answers)
  })
  return { evaluate }
}

function stagesOf(calls: Array<{ stage: string }>): string[] {
  return calls.filter(c => c.stage).map(c => c.stage)
}

describe('runWorkflow verify claim-check (roadmap #31 phase 5, PT-080)', () => {
  it('disabled: no provider call, no claim_check telemetry', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile({ decision_layer: { model: 'jev-test', features: { claim_check: undefined, workflow_routing: 'disabled' } } })
    const provider = claimsProvider()
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `claim-disabled-${Math.random()}`)
    const events = baseEvents()
    const { loop } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFixed(), new AbortController().signal, { loop })

    expect(provider.evaluate).not.toHaveBeenCalled()
    expect(readTelemetryLines().some(e => e.kind === 'claim_check')).toBe(false)
  })

  it('shadow: logs a claim_check event but does not change the stage sequence vs disabled', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const shadowProfile = profile({ decision_layer: { model: 'jev-test', features: { claim_check: 'shadow', workflow_routing: 'disabled' } } })
    const runtime = new DecisionRuntimeService({ provider: claimsProvider({ sequence: [0.9] }), model: 'jev-test' })
    const session1 = createSession(shadowProfile.name, `claim-shadow-${Math.random()}`)
    const observations: any[] = []
    const events1 = baseEvents({ onWorkflowMap: (value: any) => observations.push(value) })
    const withShadow = fakeLoop()
    const shadowContext = context(shadowProfile, session1, runtime, events1)
    shadowContext.runId = 'run-map-claim-shadow'
    await runWorkflow('bugfix', shadowProfile, session1, shadowContext, events1, openaiFixed(), new AbortController().signal, { loop: withShadow.loop })

    const disabledProfile = profile({ decision_layer: undefined })
    const session2 = createSession(disabledProfile.name, `claim-disabled-parity-${Math.random()}`)
    const events2 = baseEvents()
    const withoutShadow = fakeLoop()
    await runWorkflow('bugfix', disabledProfile, session2, context(disabledProfile, session2), events2, openaiFixed(), new AbortController().signal, { loop: withoutShadow.loop })

    expect(stagesOf(withShadow.calls)).toEqual(stagesOf(withoutShadow.calls))

    const claimEvents = readTelemetryLines().filter(e => e.kind === 'claim_check')
    expect(claimEvents.length).toBe(1)
    expect(claimEvents[0].claim_verdict).toBe('pass')
    expect(claimEvents[0].claim_applied).toBe(false)
    expect(observations.some(value => value.kind === 'advice' && value.advice.kind === 'claim_check' && value.advice.mode === 'shadow' && value.advice.action === 'pass' && value.advice.applied === false)).toBe(true)
    expect(observations.some(value => value.kind === 'transition' && value.transition.kind === 'claim_reentry')).toBe(false)
  })

  it('enforce, supported claim: proceeds to accepted, one claim_check event, not applied', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const runtime = new DecisionRuntimeService({ provider: claimsProvider({ sequence: [0.9] }), model: 'jev-test' })
    const session = createSession(p.name, `claim-pass-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFixed(), new AbortController().signal, { loop })

    expect(stagesOf(calls)).toEqual(['recon', 'plan', 'design', 'build', 'verify', 'review'])
    expect(session.messages.at(-1)).toEqual({ role: 'assistant', content: KITCHEN_SINK })

    const claimEvents = readTelemetryLines().filter(e => e.kind === 'claim_check')
    expect(claimEvents.length).toBe(1)
    expect(claimEvents[0].claim_count).toBe(1)
    expect(claimEvents[0].claim_verdict).toBe('pass')
    expect(claimEvents[0].claim_applied).toBe(false)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('enforce, unsupported claim: re-runs build then verify, counted as a re-entry, then accepts once supported', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const runtime = new DecisionRuntimeService({ provider: claimsProvider({ sequence: [0.1, 0.9] }), model: 'jev-test' })
    const session = createSession(p.name, `claim-retry-${Math.random()}`)
    const observations: any[] = []
    const events = baseEvents({ onWorkflowMap: (value: any) => observations.push(value) })
    const { loop, calls } = fakeLoop()
    const runContext = context(p, session, runtime, events)
    runContext.runId = 'run-map-claim-reentry'
    await runWorkflow('bugfix', p, session, runContext, events, openaiFixed(), new AbortController().signal, { loop })

    const stages = stagesOf(calls)
    expect(stages.filter(s => s === 'build').length).toBe(2)
    expect(stages.filter(s => s === 'verify').length).toBe(2)
    expect(stages.filter(s => s === 'recon').length).toBe(1) // never re-runs recon

    const claimEvents = readTelemetryLines().filter(e => e.kind === 'claim_check')
    expect(claimEvents.length).toBe(2)
    expect(claimEvents[0].claim_verdict).toBe('fail')
    expect(claimEvents[0].claim_applied).toBe(true)
    expect(claimEvents[1].claim_verdict).toBe('pass')
    expect(claimEvents[1].claim_applied).toBe(false)
    expect(observations.some(value => value.kind === 'advice' && value.advice.kind === 'claim_check' && value.advice.action === 'retry' && value.advice.applied === true)).toBe(true)
    expect(observations.some(value => value.kind === 'transition' && value.transition.kind === 'claim_reentry')).toBe(true)

    const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
    const accepted = outcomeEvents.find(e => e.verdict === 'accepted')
    expect(accepted).toBeDefined()
    expect(accepted.rework_count).toBeGreaterThanOrEqual(1)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('enforce, unsupported claim past retries: abandons with reason, onSessionEnd fires exactly once', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile({ workflow: { ...profile().workflow, budget: { max_usd_per_task: 2, max_stage_retries: 0, max_stage_minutes: 15 } } })
    const runtime = new DecisionRuntimeService({ provider: claimsProvider({ sequence: [0.1] }), model: 'jev-test' })
    const session = createSession(p.name, `claim-abandon-${Math.random()}`)
    const events = baseEvents()
    const { loop } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFixed(), new AbortController().signal, { loop })

    const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
    const abandoned = outcomeEvents.find(e => e.verdict === 'abandoned')
    expect(abandoned).toBeDefined()
    expect(abandoned.reason).toBe('claim-check failed')
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('no evidence: skips the check (never fails), logs claim_skipped', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const provider = claimsProvider({ sequence: [0.1] }) // would fail if ever called
    const runtime = new DecisionRuntimeService({ provider, model: 'jev-test' })
    const session = createSession(p.name, `claim-no-evidence-${Math.random()}`)
    const events = baseEvents()
    const { loop } = fakeLoop({ withTools: false })
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFixed(), new AbortController().signal, { loop })

    expect(provider.evaluate).not.toHaveBeenCalled()
    const claimEvents = readTelemetryLines().filter(e => e.kind === 'claim_check')
    expect(claimEvents.length).toBe(1)
    expect(claimEvents[0].claim_skipped).toBe('no_evidence')
    expect(claimEvents[0].claim_applied).toBe(false)
    const outcomeEvents = readTelemetryLines().filter(e => e.kind === 'outcome')
    expect(outcomeEvents.some(e => e.verdict === 'accepted')).toBe(true)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('no verify stage in the playbook run: checked once before acceptance', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const runtime = new DecisionRuntimeService({ provider: claimsProvider({ sequence: [0.9] }), model: 'jev-test' })
    const session = createSession(p.name, `claim-no-verify-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFixed({ recon: 1, plan: 1, design: 1, build: 1, verify: 0, review: 1 }), new AbortController().signal, { loop })

    expect(stagesOf(calls)).toEqual(['recon', 'plan', 'design', 'build', 'review'])
    const claimEvents = readTelemetryLines().filter(e => e.kind === 'claim_check')
    expect(claimEvents.length).toBe(1)
    expect(claimEvents[0].claim_verdict).toBe('pass')
  })

  it('Jev provider failure: proceeds (bounded claim_fallback logged), never blocks the run', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const runtime = new DecisionRuntimeService({ provider: claimsProvider({ throwError: new Error('claim provider unavailable') }), model: 'jev-test' })
    const session = createSession(p.name, `claim-jev-failure-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFixed(), new AbortController().signal, { loop })

    expect(stagesOf(calls)).toEqual(['recon', 'plan', 'design', 'build', 'verify', 'review'])
    const claimEvents = readTelemetryLines().filter(e => e.kind === 'claim_check')
    expect(claimEvents.length).toBe(1)
    expect(claimEvents[0].claim_fallback).toBeDefined()
    expect(claimEvents[0].claim_applied).toBe(false)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })

  it('telemetry never carries claim or evidence text', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile()
    const runtime = new DecisionRuntimeService({ provider: claimsProvider({ sequence: [0.9] }), model: 'jev-test' })
    const session = createSession(p.name, `claim-telemetry-safe-${Math.random()}`)
    const events = baseEvents()
    const { loop } = fakeLoop()
    await runWorkflow('bugfix', p, session, context(p, session, runtime, events), events, openaiFixed(), new AbortController().signal, { loop })

    const claimEvents = readTelemetryLines().filter(e => e.kind === 'claim_check')
    expect(claimEvents.length).toBe(1)
    const serialized = JSON.stringify(claimEvents[0])
    expect(serialized).not.toContain(CLAIM_SENTENCE)
    expect(serialized).not.toContain('12 tests passed')
  })

  it('with edge checks also enforced, an always-failing claim-check still terminates (abandoned, onSessionEnd once)', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile({ decision_layer: { model: 'jev-test', features: { claim_check: 'enforce', edge_checks: 'enforce', workflow_routing: 'disabled' } } })
    const evaluate = vi.fn(async (input: any) => {
      if (input.questions.next) {
        return success({
          next: { type: 'choice', choice: 'continue', probabilities: { continue: 1 }, confidence: 0.9 },
          failed_back: { type: 'choice', choice: 'none', probabilities: { none: 1 }, confidence: 0.9 },
        })
      }
      return success(Object.fromEntries(Object.keys(input.questions).map(key => [key, { type: 'noul', noul: 0.05 }])))
    })
    const runtime = new DecisionRuntimeService({ provider: { evaluate }, model: 'jev-test' })
    const session = createSession(p.name, `claim-edge-combined-${Math.random()}`)
    const events = baseEvents()
    const { loop, calls } = fakeLoop()
    await runWorkflow('fix the bug', p, session, context(p, session, runtime, events), events, openaiFixed(), new AbortController().signal, { loop })

    expect(calls.length).toBeLessThan(40)
    const outcome = readTelemetryLines().find(e => e.kind === 'outcome' && !e.explore)
    expect(outcome?.verdict).toBe('abandoned')
    expect(outcome?.reason).toBe('claim-check failed')
    expect(readTelemetryLines().some(e => e.kind === 'edge' && e.edge_applied)).toBe(true)
    expect(events.onSessionEnd).toHaveBeenCalledTimes(1)
  })
})
