import { describe, expect, it } from 'vitest'
import { serializeCodexRequest } from '../../src/provider/codex/request.js'
import { effortCapabilityFromValues } from '../../src/models/effort.js'

describe('Codex effort serialization', () => {
  const capability = effortCapabilityFromValues(['low', 'medium', 'high'], 'medium')
  it('serializes exact selected value', () => {
    expect(serializeCodexRequest({ model: 'gpt-6-astra', messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'high', effortCapability: capability }).reasoning).toEqual({ effort: 'high' })
  })
  it('omits reasoning for Default/null', () => {
    expect(serializeCodexRequest({ model: 'gpt-6-astra', messages: [{ role: 'user', content: 'x' }], reasoningEffort: null, effortCapability: capability })).not.toHaveProperty('reasoning')
  })
  it('rejects unsupported values before transport', () => {
    expect(() => serializeCodexRequest({ model: 'gpt-6-astra', messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'max', effortCapability: capability })).toThrow(/unsupported/)
  })
})
