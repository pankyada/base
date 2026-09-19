import { describe, expect, it, vi } from 'vitest'
import { DecisionRuntimeControlError, DecisionRuntimeService, type CapabilitySelectionInput } from '../src/decisions/runtime.js'
import type { DecisionProvider } from '../src/decisions/types.js'

function input(signal: AbortSignal): CapabilitySelectionInput {
  return {
    request: 'inspect the release log',
    profile: { name: 'fixture' } as any,
    skills: [],
    tools: [{ name: 'Read', kind: 'tool', description: 'Read a release log' }],
    mcpEntries: [],
    taskKey: 'run:stale-check',
    signal,
  }
}

describe('decision runtime cancellation boundaries', () => {
  it('does not accept a semantic result that completes after cancellation', async () => {
    const controller = new AbortController()
    let resolveProvider!: (value: any) => void
    const provider = {
      evaluate: vi.fn(() => new Promise(resolve => { resolveProvider = resolve }))
    } as unknown as DecisionProvider
    const runtime = new DecisionRuntimeService({ mode: 'enforce', model: 'jev-test', provider })
    const pending = runtime.selectCapabilities(input(controller.signal))
    controller.abort()
    resolveProvider({
      kind: 'success',
      response: { model: 'jev-test', answers: { 'tool:Read': { type: 'noul', noul: 1 } }, usage: { input_tokens: 1, output_tokens: 1 } },
      cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1,
    })
    await expect(pending).rejects.toEqual(new DecisionRuntimeControlError('cancelled'))
  })
})
