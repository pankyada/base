import { describe, expect, it } from 'vitest'
import { createWorkflowDecisionAdvisor, WorkflowDecisionControlError } from '../src/decisions/workflow.js'
import { clearTriageCache, triageA, triageB } from '../src/workflow/triage.js'
import { loadPlaybook } from '../src/workflow/playbook.js'

const profile: any = { name: 'test', model: { id: 'default' }, workflow: { min_intensity: { recon: 1 }, max_intensity: { build: 2 } }, models: { roles: { cheap: 'cheap' } } }

function success(answers: Record<string, any>): any {
  return { kind: 'success', response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
}

describe('workflow Jev routing', () => {
  it('chooses only configured task classes and known intensities', async () => {
    clearTriageCache()
    const playbook = loadPlaybook('coding')
    let request: any
    const advisor = createWorkflowDecisionAdvisor({ model: 'jev-test', provider: { evaluate: async input => {
      request = input
      return success({ task_class: { type: 'choice', choice: 'bugfix' }, recon_intensity: { type: 'choice', choice: '3' } })
    } } })
    await expect(triageA('fix the crash', playbook, undefined, profile, undefined, advisor)).resolves.toEqual({ task_class: 'bugfix', recon_intensity: 3 })
    expect(request.state.allowed_task_classes).toContain('bugfix')
    expect(request.questions.task_class.criteria.made_up).toBeUndefined()
  })

  it('selects known plan intensities, then applies existing profile clamps', async () => {
    clearTriageCache()
    const playbook = loadPlaybook('coding')
    const advisor = createWorkflowDecisionAdvisor({ model: 'jev-test', provider: { evaluate: async input => {
      const answers: Record<string, any> = { task_class: { type: 'choice', choice: 'feature' } }
      for (const key of Object.keys(input.questions).filter(key => key.startsWith('intensity_'))) answers[key] = { type: 'choice', choice: key === 'intensity_build' ? '3' : '0' }
      return success(answers)
    } } })
    const plan = await triageB('add a feature', 'Files touched: src/app.ts', playbook, undefined, profile, 'feature', undefined, advisor)
    expect(plan.task_class).toBe('feature')
    expect(plan.intensity.build).toBe(2)
    expect(plan.intensity.recon).toBe(1)
  })

  it('falls back on ordinary provider failure and propagates controls', async () => {
    clearTriageCache()
    const playbook = loadPlaybook('coding')
    const unavailable = createWorkflowDecisionAdvisor({ model: 'jev-test', provider: { evaluate: async () => ({ kind: 'unavailable', reason: 'network_error', retryable: true }) } })
    await expect(triageA('unknown', playbook, undefined, profile, undefined, unavailable)).resolves.toEqual({ task_class: 'ui-tweak', recon_intensity: 1 })
    const cancelled = createWorkflowDecisionAdvisor({ model: 'jev-test', provider: { evaluate: async () => ({ kind: 'control', reason: 'cancelled' }) } })
    await expect(triageA('cancel', playbook, undefined, profile, undefined, cancelled)).rejects.toBeInstanceOf(WorkflowDecisionControlError)
  })
})
