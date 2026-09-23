import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { DefaultImprover } from '../src/improver/default-improver.js'
import { readRoutingMisses, routingMissesPath } from '../src/workflow/routing-misses.js'

// Roadmap #31 phase 6 (PT-081), spec §6 item 4: playbook mining proposal.

function fakeOpenAI(content: string) {
  return { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } } } as any
}

const VALID_DRAFT = [
  '---',
  'name: incident-response',
  'description: Handle a production incident end to end',
  'stages: [recon, plan, build, verify]',
  'task_classes: [general]',
  'defaults:',
  '  general: { recon: 1, plan: 1, design: 0, build: 2, verify: 1, review: 0 }',
  '---',
  '',
  '## recon',
  '### L1',
  'Required artifact sections: `Files touched`, `Prior knowledge`, `Open questions`.',
  'Exit criteria: current state inspected.',
  '',
  '## plan',
  '### L1',
  'Required artifact sections: `Plan`, `Risks`.',
  'Exit criteria: sequence and risks explicit.',
].join('\n')

function profile(overrides: Record<string, unknown> = {}, artifactDir = `/tmp/h-test-playbook-mining-${Math.random().toString(36).slice(2)}`): any {
  return {
    name: 'coding',
    artifact_dir: artifactDir,
    model: { id: 'x' },
    improvement: { enabled: true },
    workflow: { router: { mining: { enabled: true, min_cluster: 10 } } },
    ...overrides,
  }
}

function seedMisses(p: any, count: number): void {
  const misses = Array.from({ length: count }, (_, i) => ({ at: new Date().toISOString(), excerpt: `request ${i}`, max_domain_p: 0.2 }))
  mkdirSync(join(p.artifact_dir, 'routing'), { recursive: true })
  writeFileSync(routingMissesPath(p), JSON.stringify(misses))
}

describe('DefaultImprover.minePlaybooks', () => {
  it('mining disabled: returns null and leaves the store untouched', async () => {
    const p = profile({ workflow: { router: { mining: { enabled: false, min_cluster: 10 } } } })
    seedMisses(p, 20)
    const openai = fakeOpenAI(VALID_DRAFT)
    const result = await new DefaultImprover(p, openai).minePlaybooks!()
    expect(result).toBeNull()
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
    expect(readRoutingMisses(p).length).toBe(20)
  })

  it('respects min_cluster: fewer misses than the threshold => null, store kept', async () => {
    const p = profile()
    seedMisses(p, 5)
    expect(await new DefaultImprover(p, fakeOpenAI(VALID_DRAFT)).minePlaybooks!()).toBeNull()
    expect(readRoutingMisses(p).length).toBe(5)
  })

  it('respects a custom min_cluster', async () => {
    const p = profile({ workflow: { router: { mining: { enabled: true, min_cluster: 3 } } } })
    seedMisses(p, 3)
    expect(await new DefaultImprover(p, fakeOpenAI(VALID_DRAFT)).minePlaybooks!()).not.toBeNull()
  })

  it('valid draft: writes PLAYBOOK.md under _proposed, clears misses, returns name+path', async () => {
    const artifactDir = `/tmp/h-test-playbook-mining-${Math.random().toString(36).slice(2)}`
    rmSync(artifactDir, { recursive: true, force: true })
    const p = profile({}, artifactDir)
    seedMisses(p, 20)
    const result = await new DefaultImprover(p, fakeOpenAI(VALID_DRAFT)).minePlaybooks!()
    expect(result).not.toBeNull()
    expect(result!.name).toBe('incident-response')
    expect(result!.path).toBe(join(artifactDir, 'playbooks', '_proposed', 'incident-response', 'PLAYBOOK.md'))
    expect(existsSync(result!.path)).toBe(true)
    expect(matter(readFileSync(result!.path, 'utf8')).data.name).toBe('incident-response')
    expect(readRoutingMisses(p)).toEqual([])
    rmSync(artifactDir, { recursive: true, force: true })
  })

  it('rejects an invalid draft (missing description) and never clears misses', async () => {
    const p = profile()
    seedMisses(p, 20)
    const invalid = VALID_DRAFT.replace('description: Handle a production incident end to end\n', '')
    expect(await new DefaultImprover(p, fakeOpenAI(invalid)).minePlaybooks!()).toBeNull()
    expect(readRoutingMisses(p).length).toBe(20)
  })

  it('rejects a draft with an invalid stage name', async () => {
    const p = profile()
    seedMisses(p, 20)
    const invalid = VALID_DRAFT.replace('stages: [recon, plan, build, verify]', 'stages: [recon, plan, nonsense, verify]')
    expect(await new DefaultImprover(p, fakeOpenAI(invalid)).minePlaybooks!()).toBeNull()
    expect(readRoutingMisses(p).length).toBe(20)
  })

  it('a model response of NONE (no coherent cluster) => null, store kept', async () => {
    const p = profile()
    seedMisses(p, 20)
    expect(await new DefaultImprover(p, fakeOpenAI('NONE')).minePlaybooks!()).toBeNull()
    expect(readRoutingMisses(p).length).toBe(20)
  })

  it('improvement disabled entirely => null, never calls the model', async () => {
    const p = profile({ improvement: { enabled: false } })
    seedMisses(p, 20)
    const openai = fakeOpenAI(VALID_DRAFT)
    expect(await new DefaultImprover(p, openai).minePlaybooks!()).toBeNull()
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
  })
})
