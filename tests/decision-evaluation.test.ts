import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('synthetic decision evaluation', () => {
  it('keeps concrete action descriptions and source-grounded memory fields in the fixture state', () => {
    const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/decision-evaluation.json'), 'utf8')) as { cases: Array<{ request: string; candidates: Array<{ id: string; description: string }>; memory_candidate: { source_id: string; source_excerpt: string; source_role: string; scope: string } }> }
    for (const testCase of fixture.cases) {
      expect(testCase.request.length).toBeGreaterThan(0)
      expect(testCase.candidates.every(candidate => candidate.id.length > 0 && candidate.description.length > 0)).toBe(true)
      expect(testCase.memory_candidate.source_id.length).toBeGreaterThan(0)
      expect(testCase.memory_candidate.source_excerpt.length).toBeGreaterThan(0)
      expect(testCase.memory_candidate.source_role.length).toBeGreaterThan(0)
      expect(testCase.memory_candidate.scope.length).toBeGreaterThan(0)
    }
  })

  it('runs offline without a credential and reports bounded aggregate evidence', () => {
    const output = execFileSync('pnpm', ['exec', 'tsx', 'scripts/evaluate-decisions.ts', '--json'], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' })
    const result = JSON.parse(output) as { mode: string; production_accuracy: string; case_ids: string[]; metrics: { capability_precision: number; capability_recall: number; unsupported_memory_promotions: number }; cost_usd: number }
    expect(result.mode).toBe('offline')
    expect(result.production_accuracy).toBe('unknown')
    expect(result.case_ids).toHaveLength(4)
    expect(result.metrics.capability_precision).toBeGreaterThanOrEqual(0)
    expect(result.metrics.capability_recall).toBeGreaterThanOrEqual(0)
    expect(result.metrics.unsupported_memory_promotions).toBe(0)
    expect(result.cost_usd).toBeGreaterThan(0)
  })
})
