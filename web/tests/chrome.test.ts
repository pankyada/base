import { describe, expect, it } from 'vitest'
import { contextPercent } from '../components/chrome/ContextGauge'
import { appendToast, toastDuration } from '../components/chrome/Toasts'
import { stageLabel } from '../components/turn/StageStrip'

describe('web chrome', () => {
  it('calculates context percentage and degrades when window unknown', () => {
    expect(contextPercent(40, 100)).toBe(40)
    expect(contextPercent(140, 100)).toBe(100)
    expect(contextPercent(40, undefined)).toBeNull()
  })

  it('labels stage with intensity, tier, cost, and escalation', () => {
    expect(stageLabel({ stage: 'verify', intensity: 2, tier: 'balanced', model: 'm', state: 'escalated', costUsd: 0.12 })).toContain('verify · I2 · balanced · $0.12 · escalated')
  })

  it('dedupes toasts and uses level-specific durations', () => {
    const first = appendToast([], { level: 'warn', message: 'watch' })
    expect(appendToast(first, { level: 'warn', message: 'watch' })).toHaveLength(1)
    expect(toastDuration('error')).toBeGreaterThan(toastDuration('info'))
  })
})
