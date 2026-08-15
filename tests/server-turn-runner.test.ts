import { describe, expect, it, vi } from 'vitest'
import { runApprovedPlanFollowOn, runInteractiveTurn } from '../src/server/turn-runner.js'

describe('interactive turn routing', () => {
  it('routes an approved plan follow-on to one agent loop without rerunning workflow', async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(undefined)
    const runWorkflow = vi.fn().mockResolvedValue(undefined)
    const persistPlan = vi.fn()
    const profile = { workflow: { enabled: true } } as any

    await runApprovedPlanFollowOn('request', 'steps', persistPlan, approved => runInteractiveTurn(approved, profile, {} as any, {} as any, {} as any, {} as any, new AbortController().signal, true, { runAgentLoop, runWorkflow }))

    expect(persistPlan).toHaveBeenCalledOnce()
    expect(runAgentLoop).toHaveBeenCalledOnce()
    expect(runAgentLoop.mock.calls[0][0]).toBe('request\n\nApproved plan:\nsteps')
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('runs workflow for an ordinary message on a workflow-enabled profile', async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(undefined)
    const runWorkflow = vi.fn().mockResolvedValue(undefined)

    await runInteractiveTurn('new request', { workflow: { enabled: true } } as any, {} as any, {} as any, {} as any, {} as any, new AbortController().signal, false, { runAgentLoop, runWorkflow })

    expect(runWorkflow).toHaveBeenCalledOnce()
    expect(runAgentLoop).not.toHaveBeenCalled()
  })
})
