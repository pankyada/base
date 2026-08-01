import { describe, expect, it } from 'vitest'
import { maybeShadow } from '../src/workflow/shadow.js'

const profile: any = { model: { id: 'base' }, models: { roles: { cheap: 'cheap-model', balanced: 'balanced-model', critic: 'critic-model' } }, workflow: { routing: { shadow_rate: 1 } } }
const plan: any = { task_class: 'feature', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 2, design: 2, build: 2, verify: 1, review: 1 }, confidence: 1, why: 'test' }

describe('paired shadow routing', () => {
  it('runs only plan/design, randomizes blind judge input, and swallows failures', async () => {
    const seen: string[] = []
    const result = await maybeShadow('plan', plan, profile, async model => { seen.push(model); return model === 'cheap-model' ? 'cheap artifact' : 'chosen artifact' }, async (input, model) => { expect(model).toBe('critic-model'); expect(input).not.toContain('cheap-model'); expect(input).not.toContain('balanced-model'); return 'A stronger' }, { chosenTier: 'balanced', rng: (() => { const values = [0, 0.9]; return () => values.shift() ?? 0 })() })
    expect(result?.chosenTier).toBe('balanced')
    expect(seen).toEqual(['balanced-model', 'cheap-model'])
    expect(await maybeShadow('build', plan, profile, async () => 'x', async () => 'x', { rng: () => 0 })).toBeNull()
    expect(await maybeShadow('design', plan, profile, async () => { throw new Error('shadow down') }, async () => 'x', { rng: () => 0 })).toBeNull()
  })
})
