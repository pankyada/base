import { describe, expect, it } from 'vitest'
import { effortCapabilityFromValues, normalizeEffortCapability, resolveEffortSelection, validateEffortSelection } from '../src/models/effort.js'

describe('model effort capability contract', () => {
  it('keeps provider order, deduplicates values, and gates ultra', () => {
    const capability = effortCapabilityFromValues(['low', 'medium', 'low', 'ultra'], 'medium')
    expect(capability.status).toBe('supported')
    expect(capability.options.map(option => [option.value, option.selectable])).toEqual([
      ['low', true], ['medium', true], ['ultra', false],
    ])
    expect(capability.provider_default).toBe('medium')
  })

  it('treats malformed and control-character metadata as unknown', () => {
    expect(normalizeEffortCapability({ options: 'high' })).toMatchObject({ status: 'unknown', options: [] })
    expect(normalizeEffortCapability({ options: ['high\u0000'] })).toMatchObject({ status: 'unknown', options: [] })
  })

  it('resolves saved, profile, then provider default without inventing a value', () => {
    const capability = effortCapabilityFromValues(['low', 'high'], 'low')
    expect(resolveEffortSelection({ capability, savedEffort: 'high', profileEffort: 'low' })).toBe('high')
    expect(resolveEffortSelection({ capability, savedEffort: 'removed', profileEffort: 'low' })).toBe('low')
    expect(resolveEffortSelection({ capability, profileEffort: 'removed' })).toBeNull()
    expect(resolveEffortSelection({ capability })).toBeNull()
  })

  it('rejects explicit selection unless live selectable metadata allows it', () => {
    const capability = effortCapabilityFromValues(['low', 'ultra'], 'low')
    validateEffortSelection(capability, null)
    validateEffortSelection(capability, 'low')
    expect(() => validateEffortSelection(capability, 'ultra')).toThrow(/unavailable/)
    expect(() => validateEffortSelection(undefined, 'high')).toThrow(/unavailable/)
  })
})
