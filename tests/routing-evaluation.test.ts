import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decideRoute, SCALES, type RouterConfig, type Scale } from '../src/workflow/route.js'

type RoutingCase = {
  id: string
  request: string
  session_route?: { playbook: string; scale: Scale; task_id: string; at: string }
  expected: { kind: 'ask' | 'run'; playbooks: string[]; scale: Scale | null }
  offline_signals: {
    domain: Record<string, number>
    scale: Record<Scale, number>
    has_existing_work: number
    ambiguous: number
    continues_previous?: number
  }
}

type Corpus = { provenance: { name: string; description: string; created: string }; cases: RoutingCase[] }

const corpus = JSON.parse(readFileSync(resolve(import.meta.dirname, '../tests/fixtures/routing-evaluation.json'), 'utf8')) as Corpus
const PLAYBOOKS = ['coding', 'data', 'generic', 'research', 'security', 'writing']
const config: RouterConfig = { domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1 }

describe('routing-evaluation.json corpus integrity (roadmap #31 phase 2, PT-077)', () => {
  it('parses and carries a provenance header', () => {
    expect(corpus.provenance.name).toBeTruthy()
    expect(corpus.provenance.description).toBeTruthy()
    expect(corpus.provenance.created).toBeTruthy()
  })

  it('has at least 30 labeled cases', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(30)
  })

  it('every case has a unique id', () => {
    const ids = corpus.cases.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers every candidate playbook at least 3 times as an expected primary or member', () => {
    const counts = new Map<string, number>(PLAYBOOKS.map(p => [p, 0]))
    for (const testCase of corpus.cases) {
      if (testCase.expected.kind !== 'run') continue
      for (const p of testCase.expected.playbooks) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    for (const playbook of PLAYBOOKS) expect(counts.get(playbook) ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('covers all four scale levels', () => {
    const scales = new Set(corpus.cases.filter(c => c.expected.kind === 'run').map(c => c.expected.scale))
    for (const level of SCALES) expect(scales.has(level)).toBe(true)
  })

  it('has at least 4 ambiguous (ask) cases', () => {
    expect(corpus.cases.filter(c => c.expected.kind === 'ask').length).toBeGreaterThanOrEqual(4)
  })

  it('has at least 4 multi-domain cases (2 expected playbooks)', () => {
    expect(corpus.cases.filter(c => c.expected.kind === 'run' && c.expected.playbooks.length === 2).length).toBeGreaterThanOrEqual(4)
  })

  it('has at least 3 follow-up cases with a session route', () => {
    expect(corpus.cases.filter(c => c.session_route !== undefined).length).toBeGreaterThanOrEqual(3)
  })

  it('offline signals produce 100% agreement with decideRoute (tests decideRoute + corpus integrity, not Jev)', () => {
    const mismatches: string[] = []
    for (const testCase of corpus.cases) {
      const decision = decideRoute(testCase.offline_signals, config, 'generic', config.max_clarifications, testCase.session_route)
      if (decision.kind !== testCase.expected.kind) {
        mismatches.push(`${testCase.id}: kind ${decision.kind} != ${testCase.expected.kind}`)
        continue
      }
      if (decision.kind === 'run' && testCase.expected.kind === 'run') {
        if (JSON.stringify(decision.playbooks) !== JSON.stringify(testCase.expected.playbooks)) {
          mismatches.push(`${testCase.id}: playbooks ${JSON.stringify(decision.playbooks)} != ${JSON.stringify(testCase.expected.playbooks)}`)
        }
        if (decision.scale !== testCase.expected.scale) {
          mismatches.push(`${testCase.id}: scale ${decision.scale} != ${testCase.expected.scale}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
