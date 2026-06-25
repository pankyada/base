import { describe, it, expect, vi, beforeEach } from 'vitest'
import { estimateCost } from '../src/loop/agent-loop.js'

describe('estimateCost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('known models', () => {
    it('claude-sonnet-4-6 returns correct calculation', () => {
      // Input: 0.000003, Output: 0.000015
      const cost = estimateCost('claude-sonnet-4-6', 1000, 500)
      const expected = (1000 * 0.000003) + (500 * 0.000015)
      expect(cost).toBe(expected)
      expect(cost).toBe(0.0105)
    })

    it('claude-opus-4-8 returns correct calculation', () => {
      // Input: 0.000015, Output: 0.000075
      const cost = estimateCost('claude-opus-4-8', 1000, 500)
      const expected = (1000 * 0.000015) + (500 * 0.000075)
      expect(cost).toBe(expected)
      expect(cost).toBe(0.0525)
    })

    it('gpt-4o returns correct calculation', () => {
      // Input: 0.0000025, Output: 0.00001
      const cost = estimateCost('gpt-4o', 1000, 500)
      const expected = (1000 * 0.0000025) + (500 * 0.00001)
      expect(cost).toBe(expected)
      expect(cost).toBe(0.0075)
    })

    it('gpt-5.4-mini-2026-03-17 returns correct calculation', () => {
      // Input: 0.00000015, Output: 0.0000006
      const cost = estimateCost('gpt-5.4-mini-2026-03-17', 1000, 500)
      const expected = (1000 * 0.00000015) + (500 * 0.0000006)
      expect(cost).toBe(expected)
      expect(cost).toBeCloseTo(0.00045)
    })

    it('does not warn for known model', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      estimateCost('claude-sonnet-4-6', 100, 50)
      expect(consoleWarnSpy).not.toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('unknown models', () => {
    it('uses fallback pricing for unknown model', () => {
      // Fallback: Input: 0.000003, Output: 0.000015
      const cost = estimateCost('unknown-model-xyz', 1000, 500)
      const expected = (1000 * 0.000003) + (500 * 0.000015)
      expect(cost).toBe(expected)
      expect(cost).toBe(0.0105)
    })

    it('warns when model is unknown', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      estimateCost('unknown-model-xyz', 100, 50)
      expect(consoleWarnSpy).toHaveBeenCalledWith('[cost] unknown model "unknown-model-xyz" — using fallback pricing')
      consoleWarnSpy.mockRestore()
    })

    it('warns only once per unknown model call', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      estimateCost('future-model-2099', 100, 50)
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
      consoleWarnSpy.mockRestore()
    })
  })

  describe('edge cases', () => {
    it('handles zero tokens', () => {
      const cost = estimateCost('claude-sonnet-4-6', 0, 0)
      expect(cost).toBe(0)
    })

    it('handles large token counts', () => {
      const cost = estimateCost('claude-sonnet-4-6', 100000, 50000)
      const expected = (100000 * 0.000003) + (50000 * 0.000015)
      expect(cost).toBe(expected)
      expect(cost).toBe(1.05)
    })

    it('haiku model has lowest cost', () => {
      const haikuCost = estimateCost('claude-haiku-4-5-20251001', 1000, 500)
      const sonnetCost = estimateCost('claude-sonnet-4-6', 1000, 500)
      expect(haikuCost).toBeLessThan(sonnetCost)
    })

    it('opus model has highest anthropic cost', () => {
      const opusCost = estimateCost('claude-opus-4-8', 1000, 500)
      const sonnetCost = estimateCost('claude-sonnet-4-6', 1000, 500)
      expect(opusCost).toBeGreaterThan(sonnetCost)
    })
  })
})
