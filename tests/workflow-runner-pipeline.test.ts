import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { runPlanPreview, runWorkflow } from '../src/workflow/runner.js'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'coding',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-pipeline-tests',
    working_dir: process.cwd(),
    workflow: {
      enabled: true, playbook: 'coding',
      min_intensity: { recon: 1 }, max_intensity: {},
      budget: { max_usd_per_task: 2, max_stage_retries: 2, max_stage_minutes: 15 },
      routing: { policy: 'static', explore_rate: 0, shadow_rate: 0, table: { recon: 'cheap', plan: 'balanced', design: 'balanced', build: 'balanced', verify: 'cheap', review: 'critic' } },
      knowledge: { graph: false, generalization_probe: true },
    },
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
    ...overrides,
  }
}

const memory: any = {
  list: vi.fn().mockResolvedValue([]),
  read: vi.fn().mockResolvedValue(null),
  write: vi.fn(),
}

const events: any = {
  onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn(),
}

function openaiFor(intensities = { recon: 1, plan: 0, design: 0, build: 1, verify: 1, review: 0 }): any {
  return { chat: { completions: { create: vi.fn(async (request: any) => ({ choices: [{ message: { content: request.messages[0].content.includes('Classify') ? '{"task_class":"bugfix","recon_intensity":1}' : JSON.stringify({ task_class: 'bugfix', blast_radius: 'module', reversibility: 'easy', intensity: intensities, confidence: 0.9, why: 'test' }) } }] })) } } }
}

function context(profileValue: any, session: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events, openai: {}, delegateDepth: 0 }
}

describe('workflow pipeline', () => {
  it('runs an isolated recon and plan preview without mutating the session or artifact path', async () => {
    const p = profile({ workflow: undefined })
    const session = createSession(p.name, 'test')
    const before = JSON.stringify(session)
    const calls: string[] = []
    const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
      calls.push(opts.stage.stage)
      staged.messages.push({ role: 'assistant', content: opts.stage.stage === 'recon' ? '## Files touched\nnone\n## Prior knowledge\nnone\n## Open questions\nnone' : '## Plan\nsteps\n## Risks\nnone' })
    })
    const artifactPath = join(p.artifact_dir, 'workflow', session.id, 'plan.md')
    rmSync(join(p.artifact_dir, 'workflow', session.id), { recursive: true, force: true })
    const result = await runPlanPreview('plan this', p, session, context(p, session), events, openaiFor(), new AbortController().signal, loop)
    expect(calls).toEqual(['recon', 'plan'])
    expect(result.body).toContain('## Plan')
    expect(JSON.stringify(session)).toBe(before)
    expect(existsSync(artifactPath)).toBe(false)
  })

  it('runs recon before later stages and makes L0 stages zero-call', async () => {
    const p = profile()
    const session = createSession(p.name, 'test')
    const calls: string[] = []
    const loop = vi.fn(async (seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
      calls.push(opts.stage.stage)
      const body = opts.stage.stage === 'recon' ? '## Files touched\nnone\n## Prior knowledge\nno prior project knowledge\n## Open questions\nnone' : `## Result\nok`
      staged.messages.push({ role: 'assistant', content: body })
    })
    await runWorkflow('do thing', p, session, context(p, session), events, openaiFor(), new AbortController().signal, { loop })
    expect(calls[0]).toBe('recon')
    expect(calls).not.toContain('plan')
    expect(calls).toContain('build')
    expect(calls).toContain('verify')
  })

  it('fails back to named earlier stage and increases its intensity', async () => {
    const p = profile()
    const session = createSession(p.name, 'test')
    const calls: string[] = []
    let verifyCalls = 0
    const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
      calls.push(opts.stage.stage)
      let body = '## Result\nok'
      if (opts.stage.stage === 'recon') body = '## Files touched\nnone\n## Prior knowledge\nno prior project knowledge\n## Open questions\nnone'
      if (opts.stage.stage === 'plan') body = '## Plan\nsteps\n## Risks\nnone'
      if (opts.stage.stage === 'verify') { verifyCalls++; body = verifyCalls === 1 ? '## Verification\nprecondition violation: design is wrong' : '## Verification\npassed' }
      if (opts.stage.stage === 'design') body = '## Design\nfixed'
      staged.messages.push({ role: 'assistant', content: body })
    })
    await runWorkflow('feature', p, session, context(p, session), events, openaiFor({ recon: 1, plan: 1, design: 1, build: 1, verify: 1, review: 0 }), new AbortController().signal, { loop })
    expect(calls.indexOf('design')).toBeLessThan(calls.lastIndexOf('verify'))
    expect(calls.filter(stage => stage === 'design').length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to plain loop when budget is exhausted', async () => {
    const p = profile({ workflow: { ...profile().workflow, budget: { max_usd_per_task: 0.01, max_stage_retries: 1, max_stage_minutes: 15 } } })
    const session = createSession(p.name, 'test')
    session.usage.cost_usd = 1
    const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts?: any) => {
      staged.messages.push({ role: 'assistant', content: 'plain' })
      expect(opts?.appendUser).toBe(false)
    })
    await runWorkflow('over budget', p, session, context(p, session), events, openaiFor(), new AbortController().signal, { loop })
    expect(loop).toHaveBeenCalledOnce()
  })

  it('promotes build after two verification failures', async () => {
    const p = profile({ workflow: { ...profile().workflow, budget: { max_usd_per_task: 2, max_stage_retries: 3, max_stage_minutes: 15 } } })
    const session = createSession(p.name, 'test')
    const calls: string[] = []
    let verifyCalls = 0
    const loop = vi.fn(async (_seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
      calls.push(`${opts.stage.stage}:${opts.stage.tier}`)
      let body = '## Result\nok'
      if (opts.stage.stage === 'recon') body = '## Files touched\nnone\n## Prior knowledge\nnone\n## Open questions\nnone'
      if (opts.stage.stage === 'plan') body = '## Plan\nsteps\n## Risks\nnone'
      if (opts.stage.stage === 'design') body = '## Design\nfixed'
      if (opts.stage.stage === 'verify') { verifyCalls++; body = verifyCalls < 3 ? '## Verification\nfailed' : '## Verification\npassed' }
      staged.messages.push({ role: 'assistant', content: body })
    })
    await runWorkflow('verify twice', p, session, context(p, session), events, openaiFor(), new AbortController().signal, { loop })
    expect(calls.filter(call => call.startsWith('build:')).length).toBe(2)
    expect(calls).toContain('build:frontier')
  })
})
