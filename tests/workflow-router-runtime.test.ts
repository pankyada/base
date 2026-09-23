import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runWorkflow } from '../src/workflow/runner.js'
import { DecisionRuntimeService } from '../src/decisions/runtime.js'
import { WorkflowDecisionControlError } from '../src/decisions/workflow.js'
import { telemetryFilePath } from '../src/telemetry/logger.js'
import { readFileSync, existsSync, rmSync } from 'fs'

function readTelemetryLines(): any[] {
  if (!existsSync(telemetryFilePath())) return []
  return readFileSync(telemetryFilePath(), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'coding',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-router-runtime-tests',
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
    decision_layer: { model: 'jev-test', features: { request_routing: 'shadow', workflow_routing: 'disabled' } },
    ...overrides,
  }
}

const memory: any = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn() }
const events: any = { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn() }

function fakeLoop() {
  const calls: string[] = []
  const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
    calls.push(opts.stage.stage)
    const body = opts.stage.stage === 'recon' ? '## Files touched\nnone\n## Prior knowledge\nnone\n## Open questions\nnone' : '## Result\nok'
    staged.messages.push({ role: 'assistant', content: body })
  })
  return { loop, calls }
}

function openaiFixed(): any {
  return { chat: { completions: { create: vi.fn(async (request: any) => ({ choices: [{ message: { content: request.messages[0].content.includes('Classify') ? '{"task_class":"bugfix","recon_intensity":1}' : JSON.stringify({ task_class: 'bugfix', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 0, design: 0, build: 1, verify: 1, review: 0 }, confidence: 0.9, why: 'test' }) } }] })) } } }
}

function context(profileValue: any, session: any, decisionRuntime?: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events, openai: {}, delegateDepth: 0, decisionRuntime }
}

function goodRouteProvider() {
  return { evaluate: vi.fn(async (input: any) => {
    const answers: Record<string, any> = {}
    for (const key of Object.keys(input.questions)) {
      if (key.startsWith('domain_')) answers[key] = { type: 'noul', noul: key === 'domain_coding' ? 0.9 : 0.1 }
    }
    answers.scale = { type: 'score', score: 1, legend: { '0': input.questions.scale.criteria[0], '1': input.questions.scale.criteria[1], '2': input.questions.scale.criteria[2], '3': input.questions.scale.criteria[3] }, probabilities: { '0': 0.1, '1': 0.6, '2': 0.2, '3': 0.1 }, confidence: 0.8 }
    answers.has_existing_work = { type: 'noul', noul: 0.4 }
    answers.ambiguous = { type: 'noul', noul: 0.2 }
    if (input.questions.continues_previous) answers.continues_previous = { type: 'noul', noul: 0.1 }
    return { kind: 'success' as const, response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
  }) }
}

async function stageSequence(p: any, decisionRuntime?: any) {
  const session = createSession(p.name, `router-test-${Math.random().toString(36).slice(2)}`)
  const { loop, calls } = fakeLoop()
  await runWorkflow('fix the crash in app.ts', p, session, context(p, session, decisionRuntime), events, openaiFixed(), new AbortController().signal, { loop })
  return calls
}

describe('runWorkflow request routing hook (roadmap #31 phase 2, PT-077)', () => {
  it('router absent: never calls the Jev provider, never logs a route event', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const evaluate = vi.fn()
    const runtime = new DecisionRuntimeService({ provider: { evaluate }, model: 'jev-test' })
    await stageSequence(profile({ workflow: { ...profile().workflow, router: undefined } }), runtime)
    expect(evaluate).not.toHaveBeenCalled()
    expect(readTelemetryLines().some(e => e.kind === 'route')).toBe(false)
  })

  it('candidates absent after intersecting with discovered playbooks: no-op', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const evaluate = vi.fn()
    const runtime = new DecisionRuntimeService({ provider: { evaluate }, model: 'jev-test' })
    const p = profile({ workflow: { ...profile().workflow, router: { candidates: ['totally-nonexistent-playbook'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1 } } })
    await stageSequence(p, runtime)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('shadow mode: emits exactly one route event and the stage sequence is identical to routing disabled', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const runtime = new DecisionRuntimeService({ provider: goodRouteProvider(), model: 'jev-test' })
    const withRouting = await stageSequence(profile(), runtime)
    const events1 = readTelemetryLines().filter(e => e.kind === 'route')
    expect(events1.length).toBe(1)
    expect(events1[0].route_mode).toBe('shadow')
    expect(events1[0].route_decision_kind).toBe('run')
    expect(events1[0].route_playbooks).toEqual(['coding'])

    rmSync(telemetryFilePath(), { force: true })
    const withoutRouting = await stageSequence(profile({ decision_layer: undefined }))
    expect(withRouting).toEqual(withoutRouting)
  })

  it('enforce mode also only logs — same stage sequence and no runtime behavior change (phase 2 invariant)', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const p = profile({ decision_layer: { model: 'jev-test', features: { request_routing: 'enforce', workflow_routing: 'disabled' } } })
    const runtime = new DecisionRuntimeService({ provider: goodRouteProvider(), model: 'jev-test' })
    const withEnforce = await stageSequence(p, runtime)
    const events1 = readTelemetryLines().filter(e => e.kind === 'route')
    expect(events1.length).toBe(1)
    expect(events1[0].route_mode).toBe('enforce')

    rmSync(telemetryFilePath(), { force: true })
    const withoutRouting = await stageSequence(profile({ decision_layer: undefined }))
    expect(withEnforce).toEqual(withoutRouting)
  })

  it('route event carries no raw request text', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const runtime = new DecisionRuntimeService({ provider: goodRouteProvider(), model: 'jev-test' })
    await stageSequence(profile(), runtime)
    const [event] = readTelemetryLines().filter(e => e.kind === 'route')
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('fix the crash in app.ts')
  })

  it('ordinary provider failure: logs a route event with a fallback reason and the run continues unchanged', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const runtime = new DecisionRuntimeService({ provider: { evaluate: async () => ({ kind: 'unavailable', reason: 'network_error', retryable: true }) }, model: 'jev-test' })
    const calls = await stageSequence(profile(), runtime)
    expect(calls).toContain('recon')
    expect(calls).toContain('build')
    const [event] = readTelemetryLines().filter(e => e.kind === 'route')
    expect(event.route_fallback).toBeDefined()
  })

  it('control outcome propagates and aborts the run (like today\'s triage control handling)', async () => {
    rmSync(telemetryFilePath(), { force: true })
    const runtime = new DecisionRuntimeService({ provider: { evaluate: async () => ({ kind: 'control', reason: 'cancelled' }) }, model: 'jev-test' })
    const p = profile()
    const session = createSession(p.name, 'router-control-test')
    const { loop } = fakeLoop()
    await expect(runWorkflow('fix the crash', p, session, context(p, session, runtime), events, openaiFixed(), new AbortController().signal, { loop })).rejects.toBeInstanceOf(WorkflowDecisionControlError)
  })
})
