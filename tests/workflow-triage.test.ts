import { describe, expect, it, vi } from 'vitest'
import { clampIntensity, clearTriageCache, triageA, triageB } from '../src/workflow/triage.js'
import { loadPlaybook } from '../src/workflow/playbook.js'

const profile: any = { name: 'test', model: { id: 'default' }, workflow: { min_intensity: { recon: 1 }, max_intensity: { build: 2 } }, models: { roles: { cheap: 'cheap' } } }
const openai = { chat: { completions: { create: async (request: any) => ({ choices: [{ message: { content: request.messages[0].content.includes('Classify') ? '{"task_class":"ui-tweak","recon_intensity":0}' : '{"task_class":"ui-tweak","blast_radius":"single-file","reversibility":"easy","intensity":{"recon":0,"build":3},"confidence":0.8,"why":"small"}' } }] }) } } } as any

describe('workflow triage', () => {
  it('caches triage-A by playbook and normalized request', async () => {
    clearTriageCache()
    const create = vi.fn(openai.chat.completions.create)
    const cachedOpenAI: any = { chat: { completions: { create } } }
    const playbook = loadPlaybook('coding')
    await triageA('  Small CSS fix  ', playbook, cachedOpenAI, profile)
    await triageA('small   css fix', playbook, cachedOpenAI, profile)
    expect(create).toHaveBeenCalledOnce()
  })

  it('forces recon and clamps stage intensity', async () => {
    const playbook = loadPlaybook('coding')
    expect((await triageA('small css fix', playbook, openai, profile)).recon_intensity).toBe(1)
    const plan = await triageB('small css fix', 'Prior knowledge: none', playbook, openai, profile)
    expect(plan.intensity.recon).toBe(1)
    expect(plan.intensity.build).toBe(2)
  })

  it('uses defaults on malformed model JSON', () => {
    const plan: any = { task_class: 'x', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 0, plan: 3, design: 0, build: 3, verify: 0, review: 0 }, confidence: 1, why: 'x' }
    const clamped = clampIntensity(plan, profile.workflow)
    expect(clamped.intensity.recon).toBe(1)
    expect(clamped.intensity.build).toBe(2)
  })
})
