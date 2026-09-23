import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runWorkflow } from '../src/workflow/runner.js'
import { DecisionRuntimeService } from '../src/decisions/runtime.js'
import { telemetryFilePath } from '../src/telemetry/logger.js'
import { rmSync, mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readRoutingMisses, routingMissesPath } from '../src/workflow/routing-misses.js'

// Roadmap #31 phase 6 (PT-081), spec §6 item 4: opt-in local misses store.
// `workflow.router.mining.enabled` gates whether a fallback route decision
// (no candidate cleared its domain threshold) is ever written to project
// memory. Disabled (the default) => never written (invariant 2).

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'coding',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: mkdtempSync(join(tmpdir(), 'router-mining-')),
    working_dir: process.cwd(),
    workflow: {
      enabled: true, playbook: 'coding',
      min_intensity: { recon: 1 }, max_intensity: {},
      budget: { max_usd_per_task: 2, max_stage_retries: 2, max_stage_minutes: 15 },
      routing: { policy: 'static', explore_rate: 0, shadow_rate: 0, table: {} },
      knowledge: { graph: false, generalization_probe: true },
      router: { candidates: ['data'], domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1, mining: { enabled: false, min_cluster: 10 } },
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

// Domain probability always below threshold -> every route decision falls back to workflow.playbook.
function lowConfidenceProvider() {
  return { evaluate: vi.fn(async (input: any) => {
    const answers: Record<string, any> = {}
    for (const key of Object.keys(input.questions)) {
      if (key.startsWith('domain_')) answers[key] = { type: 'noul', noul: 0.1 }
    }
    answers.scale = { type: 'score', score: 1, legend: { '0': input.questions.scale.criteria[0], '1': input.questions.scale.criteria[1], '2': input.questions.scale.criteria[2], '3': input.questions.scale.criteria[3] }, probabilities: { '0': 0.1, '1': 0.6, '2': 0.2, '3': 0.1 }, confidence: 0.8 }
    answers.has_existing_work = { type: 'noul', noul: 0.4 }
    answers.ambiguous = { type: 'noul', noul: 0.1 }
    if (input.questions.continues_previous) answers.continues_previous = { type: 'noul', noul: 0.1 }
    return { kind: 'success' as const, response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
  }) }
}

function memory(): any {
  return { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn().mockResolvedValue(undefined) }
}

function context(profileValue: any, session: any, mem: any, decisionRuntime?: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory: mem, skills: [], mcpEntries: [], events: baseEvents(), openai: {}, delegateDepth: 0, decisionRuntime }
}

async function runFallback(p: any, mem: any, taint?: string[]) {
  rmSync(telemetryFilePath(), { force: true })
  const session = createSession(p.name, `router-mining-${Math.random().toString(36).slice(2)}`)
  if (taint) session.taint_sources = taint
  const runtime = new DecisionRuntimeService({ provider: lowConfidenceProvider(), model: 'jev-test' })
  await runWorkflow('some request nobody can classify confidently', p, session, context(p, session, mem, runtime), baseEvents(), openaiFixed(), new AbortController().signal, { loop: fakeLoop() })
}

describe('routing-misses store (roadmap #31 phase 6, PT-081)', () => {
  const enabled = () => profile({ workflow: { ...profile().workflow, router: { ...profile().workflow.router, mining: { enabled: true, min_cluster: 10 } } } })

  it('mining disabled: never records a miss', async () => {
    const p = profile()
    await runFallback(p, memory())
    expect(readRoutingMisses(p)).toEqual([])
  })

  it('mining enabled: a fallback decision appends one bounded miss to the file store', async () => {
    const p = enabled()
    await runFallback(p, memory())
    const written = readRoutingMisses(p)
    expect(written.length).toBe(1)
    expect(written[0].excerpt.length).toBeLessThanOrEqual(500)
    expect(written[0].excerpt).toContain('some request nobody can classify')
    expect(typeof written[0].max_domain_p).toBe('number')
    expect(typeof written[0].at).toBe('string')
  })

  it('never writes misses to project memory (it is rendered into system prompts)', async () => {
    const mem = memory()
    await runFallback(enabled(), mem)
    expect(mem.write).not.toHaveBeenCalledWith('project', 'routing-misses', expect.anything())
  })

  it('never records requests from a tainted session', async () => {
    const p = enabled()
    await runFallback(p, memory(), ['unpaired channel: telegram'])
    expect(readRoutingMisses(p)).toEqual([])
  })

  it('bounds the stored list to the newest 200 entries', async () => {
    const p = enabled()
    mkdirSync(join(p.artifact_dir, 'routing'), { recursive: true })
    writeFileSync(routingMissesPath(p), JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ at: new Date(0).toISOString(), excerpt: `old-${i}`, max_domain_p: 0.1 }))))
    await runFallback(p, memory())
    const written = readRoutingMisses(p)
    expect(written.length).toBe(200)
    expect(written[written.length - 1].excerpt).toContain('some request nobody can classify')
    expect(written.some(entry => entry.excerpt === 'old-0')).toBe(false)
  })

  it('shadow mode: mining still records misses (any resolved decision, not enforce-only)', async () => {
    const p = profile({
      decision_layer: { model: 'jev-test', features: { request_routing: 'shadow', workflow_routing: 'disabled' } },
      workflow: { ...profile().workflow, router: { ...profile().workflow.router, mining: { enabled: true, min_cluster: 10 } } },
    })
    await runFallback(p, memory())
    expect(readRoutingMisses(p).length).toBe(1)
  })
})
