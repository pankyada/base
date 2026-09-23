import { describe, expect, it } from 'vitest'
import { createWorkflowDecisionAdvisor, WorkflowDecisionControlError } from '../src/decisions/workflow.js'

// Roadmap #31 phase 4 (PT-079), spec §5.4. Unit tests for `judgeEdge` on
// `WorkflowDecisionAdvisor`, mirroring tests/workflow-choose-route.test.ts's
// style for phase 2's `chooseRoute`.

function success(answers: Record<string, any>): any {
  return { kind: 'success', response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
}

function baseAnswers(next: string, failedBack: string, extra: Record<string, any> = {}) {
  return {
    next: { type: 'choice', choice: next, probabilities: { [next]: 1 }, confidence: 0.9 },
    failed_back: { type: 'choice', choice: failedBack, probabilities: { [failedBack]: 1 }, confidence: 0.9 },
    ...extra,
  }
}

describe('judgeEdge (roadmap #31 phase 4, spec §5.4)', () => {
  it('builds next/failed_back questions and parses a continue judgment with no drift candidates', async () => {
    let seenRequest: any
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async input => { seenRequest = input; return success(baseAnswers('continue', 'none')) } },
    })
    const judgment = await advisor.judgeEdge!('fix the crash', 'build', 'artifact body', 'coding', ['verify', 'review'], ['recon', 'plan'])
    expect(judgment).toEqual({ next: 'continue', failed_back: undefined, drift: {} })
    expect(seenRequest.questions.next.type).toBe('choice')
    expect(seenRequest.questions.failed_back.criteria.none).toBeDefined()
    expect(seenRequest.questions.failed_back.criteria.plan).toBeDefined()
    expect(seenRequest.questions.failed_back.criteria.recon).toBeDefined()
    expect(Object.keys(seenRequest.questions).some(k => k.startsWith('drift_'))).toBe(false)
    expect(seenRequest.state.stage).toBe('build')
    expect(seenRequest.state.playbook).toBe('coding')
    expect(seenRequest.state.remaining_stages).toEqual(['verify', 'review'])
    expect(seenRequest.state.earlier_stages).toEqual(['recon', 'plan'])
  })

  it('parses a failed_back stage', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => success(baseAnswers('continue', 'plan')) },
    })
    const judgment = await advisor.judgeEdge!('req', 'build', 'body', 'coding', [], ['recon', 'plan'])
    expect(judgment).toEqual({ next: 'continue', failed_back: 'plan', drift: {} })
  })

  it('adds sanitized drift_<name> questions only when drift candidates are passed, and round-trips them', async () => {
    let seenRequest: any
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async input => {
        seenRequest = input
        const answers: Record<string, any> = baseAnswers('reroute', 'none')
        for (const key of Object.keys(input.questions)) if (key.startsWith('drift_')) answers[key] = { type: 'noul', noul: key === 'drift_data' ? 0.9 : 0.1 }
        return success(answers)
      } },
    })
    const judgment = await advisor.judgeEdge!('req', 'build', 'body', 'coding', [], [], [{ name: 'data', description: 'Data workflow' }, { name: 'writing' }])
    expect(seenRequest.questions.drift_data).toBeDefined()
    expect(seenRequest.questions.drift_data.instructions).toContain('data')
    expect(seenRequest.questions.drift_writing).toBeDefined()
    expect(judgment).toEqual({ next: 'reroute', failed_back: undefined, drift: { data: 0.9, writing: 0.1 } })
  })

  it('round-trips sanitized/colliding drift candidate names', async () => {
    const weird = [{ name: 'My Playbook!' }, { name: 'my playbook' }]
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async input => {
        const answers: Record<string, any> = baseAnswers('continue', 'none')
        for (const key of Object.keys(input.questions)) if (key.startsWith('drift_')) answers[key] = { type: 'noul', noul: 0.6 }
        return success(answers)
      } },
    })
    const judgment = await advisor.judgeEdge!('req', 'build', 'body', 'coding', [], [], weird)
    expect(judgment!.drift['My Playbook!']).toBeCloseTo(0.6)
    expect(judgment!.drift['my playbook']).toBeCloseTo(0.6)
  })

  it('defensive parse: an unrecognized next value returns undefined', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => success(baseAnswers('nonsense', 'none')) },
    })
    const judgment = await advisor.judgeEdge!('req', 'build', 'body', 'coding', [], [])
    expect(judgment).toBeUndefined()
  })

  it('defensive parse: an unrecognized failed_back value returns undefined', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => success(baseAnswers('continue', 'nonexistent-stage')) },
    })
    const judgment = await advisor.judgeEdge!('req', 'build', 'body', 'coding', [], ['recon', 'plan'])
    expect(judgment).toBeUndefined()
  })

  it('defensive parse: a missing drift answer returns undefined', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => success(baseAnswers('continue', 'none')) }, // no drift_* answers at all
    })
    const judgment = await advisor.judgeEdge!('req', 'build', 'body', 'coding', [], [], [{ name: 'data' }])
    expect(judgment).toBeUndefined()
  })

  it('a control outcome propagates as WorkflowDecisionControlError', async () => {
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async () => ({ kind: 'control', reason: 'cancelled' }) },
    })
    await expect(advisor.judgeEdge!('req', 'build', 'body', 'coding', [], [])).rejects.toBeInstanceOf(WorkflowDecisionControlError)
  })

  it('bounds artifact and request text sent to the provider', async () => {
    let seenRequest: any
    const advisor = createWorkflowDecisionAdvisor({
      model: 'jev-test',
      provider: { evaluate: async input => { seenRequest = input; return success(baseAnswers('continue', 'none')) } },
    })
    await advisor.judgeEdge!('x'.repeat(10_000), 'build', 'y'.repeat(10_000), 'coding', [], [])
    expect(seenRequest.state.request.length).toBeLessThanOrEqual(4_000)
    expect(seenRequest.state.artifact.length).toBeLessThanOrEqual(6_000)
  })
})
