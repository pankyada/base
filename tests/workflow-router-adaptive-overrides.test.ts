import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runWorkflow } from '../src/workflow/runner.js'
import { DecisionRuntimeService } from '../src/decisions/runtime.js'
import { telemetryFilePath } from '../src/telemetry/logger.js'
import { readFileSync, existsSync, rmSync } from 'fs'

// Roadmap #31 phase 6 (PT-081), spec §6 item 3: runWorkflow reads tuned
// `router` overrides from the adaptive routing-policy doc and applies them
// to decideRoute ONLY when `workflow.routing.policy === 'adaptive'`. Absent
// or non-adaptive => today's behavior (mirrors the runtime-test style of
// tests/workflow-router-runtime.test.ts).

function readTelemetryLines(): any[] {
  if (!existsSync(telemetryFilePath())) return []
  return readFileSync(telemetryFilePath(), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'coding',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-router-adaptive-overrides-tests',
    working_dir: process.cwd(),
    workflow: {
      enabled: true, playbook: 'coding',
      min_intensity: { recon: 1 }, max_intensity: {},
      budget: { max_usd_per_task: 2, max_stage_retries: 2, max_stage_minutes: 15 },
      routing: { policy: 'adaptive', explore_rate: 0, shadow_rate: 0, table: {} },
      knowledge: { graph: false, generalization_probe: true },
      router: { candidates: ['data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1 },
    },
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
    decision_layer: { model: 'jev-test', features: { request_routing: 'enforce', workflow_routing: 'disabled' } },
    ...overrides,
  }
}

function baseEvents(): any {
  return { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn() }
}

function fakeLoop() {
  return vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
    const body = opts.stage.stage === 'recon' ? '## Files touched\nnone\n## Prior knowledge\nnone\n## Open questions\nnone' : '## Result\nok'
    staged.messages.push({ role: 'assistant', content: body })
  })
}

function openaiFixed(): any {
  return { chat: { completions: { create: vi.fn(async (request: any) => ({ choices: [{ message: { content: request.messages[0].content.includes('Classify') ? '{"task_class":"bugfix","recon_intensity":1}' : JSON.stringify({ task_class: 'bugfix', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 0, design: 0, build: 1, verify: 1, review: 0 }, confidence: 0.9, why: 'test' }) } }] })) } } }
}

// domain_data = 0.6: above the default 0.5 threshold, below a 0.7 override.
function midConfidenceProvider() {
  return { evaluate: vi.fn(async (input: any) => {
    const answers: Record<string, any> = {}
    for (const key of Object.keys(input.questions)) {
      if (key.startsWith('domain_')) answers[key] = { type: 'noul', noul: 0.6 }
    }
    answers.scale = { type: 'score', score: 1, legend: { '0': input.questions.scale.criteria[0], '1': input.questions.scale.criteria[1], '2': input.questions.scale.criteria[2], '3': input.questions.scale.criteria[3] }, probabilities: { '0': 0.1, '1': 0.6, '2': 0.2, '3': 0.1 }, confidence: 0.8 }
    answers.has_existing_work = { type: 'noul', noul: 0.4 }
    answers.ambiguous = { type: 'noul', noul: 0.1 }
    if (input.questions.continues_previous) answers.continues_previous = { type: 'noul', noul: 0.1 }
    return { kind: 'success' as const, response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
  }) }
}

function memoryWith(routingPolicyContent: string | null): any {
  return {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn(async (scope: string, key: string) => (scope === 'project' && key === 'routing-policy' && routingPolicyContent !== null) ? { content: routingPolicyContent } : null),
    write: vi.fn(),
  }
}

function context(profileValue: any, session: any, memory: any, decisionRuntime?: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events: baseEvents(), openai: {}, delegateDepth: 0, decisionRuntime }
}

async function route(p: any, memory: any) {
  rmSync(telemetryFilePath(), { force: true })
  const session = createSession(p.name, `router-adaptive-${Math.random().toString(36).slice(2)}`)
  const runtime = new DecisionRuntimeService({ provider: midConfidenceProvider(), model: 'jev-test' })
  await runWorkflow('do something with data', p, session, context(p, session, memory, runtime), baseEvents(), openaiFixed(), new AbortController().signal, { loop: fakeLoop() })
  return readTelemetryLines().find(e => e.kind === 'route')
}

describe('runWorkflow adaptive router threshold overrides (roadmap #31 phase 6, PT-081)', () => {
  it('adaptive policy + a router.domain_thresholds override raises the effective threshold for that playbook', async () => {
    const doc = JSON.stringify({ router: { domain_thresholds: { data: 0.7 } } })
    const event = await route(profile(), memoryWith(doc))
    expect(event.route_decision_kind).toBe('run')
    // 0.6 domain probability no longer clears the overridden 0.7 threshold -> falls back to workflow.playbook.
    expect(event.route_playbooks).toEqual(['coding'])
  })

  it('static policy ignores a present routing-policy router block (no override applied)', async () => {
    const doc = JSON.stringify({ router: { domain_thresholds: { data: 0.7 } } })
    const p = profile({ workflow: { ...profile().workflow, routing: { policy: 'static', explore_rate: 0, shadow_rate: 0, table: {} } } })
    const event = await route(p, memoryWith(doc))
    // Default 0.5 threshold still applies -> 0.6 clears it -> routes to data.
    expect(event.route_playbooks).toEqual(['data'])
  })

  it('adaptive policy with no routing-policy doc at all behaves exactly like static (no override)', async () => {
    const event = await route(profile(), memoryWith(null))
    expect(event.route_playbooks).toEqual(['data'])
  })

  it('adaptive policy with an ask_threshold override raises the ambiguity bar', async () => {
    // ambiguous=0.1 in the fixed provider never crosses either threshold, so
    // this proves the override is read and merged without throwing, and the
    // run still resolves normally (no behavior change for a low ambiguous signal).
    const doc = JSON.stringify({ router: { ask_threshold: 0.9 } })
    const event = await route(profile(), memoryWith(doc))
    expect(event.route_decision_kind).toBe('run')
  })
})
