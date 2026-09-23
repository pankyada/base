import { describe, expect, it } from 'vitest'
import { createWorkflowDecisionAdvisor, WorkflowDecisionControlError } from '../src/decisions/workflow.js'

function success(answers: Record<string, any>): any {
  return { kind: 'success', response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
}

const candidates = [
  { name: 'coding', description: 'Software change workflow' },
  { name: 'data', description: 'Reproducible data workflow' },
]

const scaleLegend = {
  '0': 'trivial: a one-line answer, a single small edit, or a question that needs no real work.',
  '1': 'small: a single focused change confined to one file or a narrow area, completable in one pass.',
  '2': 'medium: a multi-file change or a feature with several moving parts needing planning.',
  '3': 'large: a new multi-component system, a migration, or multi-day effort spanning many files.',
}
const scaleProbabilities = { '0': 0.1, '1': 0.6, '2': 0.2, '3': 0.1 }

function baseAnswers(extra: Record<string, any> = {}) {
  return {
    domain_coding: { type: 'noul', noul: 0.9 },
    domain_data: { type: 'noul', noul: 0.1 },
    scale: { type: 'score', score: 1, legend: scaleLegend, probabilities: scaleProbabilities, confidence: 0.8 },
    has_existing_work: { type: 'noul', noul: 0.4 },
    ambiguous: { type: 'noul', noul: 0.2 },
    ...extra,
  }
}

describe('chooseRoute (roadmap #31 phase 2, spec §5.1)', () => {
  it('builds sanitized domain_<name> questions, a scale score question, and parses signals back', async () => {
    let seenRequest: any
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async input => { seenRequest = input; return success(baseAnswers()) } },
    })
    const signals = await advisor.chooseRoute!('fix the crash in app.ts', candidates)
    expect(signals).toBeDefined()
    expect(seenRequest.questions.domain_coding).toBeDefined()
    expect(seenRequest.questions.domain_coding.instructions).toContain('coding')
    expect(seenRequest.questions.domain_coding.instructions).toContain('Software change workflow')
    expect(seenRequest.questions.domain_data).toBeDefined()
    expect(seenRequest.questions.scale.type).toBe('score')
    expect(seenRequest.questions.has_existing_work.type).toBe('noul')
    expect(seenRequest.questions.ambiguous.type).toBe('noul')
    expect(seenRequest.questions.continues_previous).toBeUndefined()
    expect(signals!.domain.coding).toBeCloseTo(0.9)
    expect(signals!.domain.data).toBeCloseTo(0.1)
    expect(signals!.scale.small).toBeCloseTo(0.6)
    expect(signals!.scale.trivial).toBeCloseTo(0.1)
    expect(signals!.has_existing_work).toBeCloseTo(0.4)
    expect(signals!.ambiguous).toBeCloseTo(0.2)
    expect(signals!.continues_previous).toBeUndefined()
  })

  it('round-trips sanitized names that collide or contain unsafe characters', async () => {
    let seenRequest: any
    const weird = [{ name: 'My Playbook!' }, { name: 'my playbook' }]
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async input => {
        seenRequest = input
        const answers: Record<string, any> = { scale: { type: 'score', score: 0, legend: scaleLegend, probabilities: scaleProbabilities, confidence: 0.8 }, has_existing_work: { type: 'noul', noul: 0 }, ambiguous: { type: 'noul', noul: 0 } }
        for (const key of Object.keys(input.questions)) if (key.startsWith('domain_')) answers[key] = { type: 'noul', noul: 0.7 }
        return success(answers)
      } },
    })
    const signals = await advisor.chooseRoute!('do a thing', weird)
    const domainKeys = Object.keys(seenRequest.questions).filter(k => k.startsWith('domain_'))
    expect(domainKeys.length).toBe(2)
    expect(signals!.domain['My Playbook!']).toBeCloseTo(0.7)
    expect(signals!.domain['my playbook']).toBeCloseTo(0.7)
  })

  it('adds continues_previous only when a session route is supplied', async () => {
    let seenRequest: any
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async input => { seenRequest = input; return success(baseAnswers({ continues_previous: { type: 'noul', noul: 0.8 } })) } },
    })
    const sessionRoute = { playbook: 'coding', scale: 'small' as const, task_id: 't1', at: new Date().toISOString() }
    const signals = await advisor.chooseRoute!('continue that', candidates, sessionRoute, 'previous assistant message')
    expect(seenRequest.questions.continues_previous).toBeDefined()
    expect(seenRequest.state.session_route).toEqual(sessionRoute)
    expect(seenRequest.state.last_assistant_message).toBe('previous assistant message')
    expect(signals!.continues_previous).toBeCloseTo(0.8)
  })

  it('returns undefined when a required answer is missing', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => success({ domain_coding: { type: 'noul', noul: 0.9 }, domain_data: { type: 'noul', noul: 0.1 } }) },
    })
    const signals = await advisor.chooseRoute!('fix the crash', candidates)
    expect(signals).toBeUndefined()
  })

  it('returns undefined when the scale answer has the wrong type', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => success(baseAnswers({ scale: { type: 'noul', noul: 0.5 } })) },
    })
    const signals = await advisor.chooseRoute!('fix the crash', candidates)
    expect(signals).toBeUndefined()
  })

  it('returns undefined when continues_previous is requested but missing from the answer', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => success(baseAnswers()) },
    })
    const sessionRoute = { playbook: 'coding', scale: 'small' as const, task_id: 't1', at: new Date().toISOString() }
    const signals = await advisor.chooseRoute!('continue', candidates, sessionRoute)
    expect(signals).toBeUndefined()
  })

  it('propagates a control outcome as WorkflowDecisionControlError', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => ({ kind: 'control', reason: 'cancelled' }) },
    })
    await expect(advisor.chooseRoute!('fix the crash', candidates)).rejects.toBeInstanceOf(WorkflowDecisionControlError)
  })

  it('throws (non-control) on ordinary provider unavailability, for the caller to catch and fall back', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => ({ kind: 'unavailable', reason: 'network_error', retryable: true }) },
    })
    await expect(advisor.chooseRoute!('fix the crash', candidates)).rejects.toThrow()
    await expect(advisor.chooseRoute!('fix the crash', candidates)).rejects.not.toBeInstanceOf(WorkflowDecisionControlError)
  })
})
