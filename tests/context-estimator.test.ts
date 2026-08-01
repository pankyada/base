import { describe, expect, it } from 'vitest'
import { calibrate, contextWindowFor, estimateTokens, rawTokens } from '../src/context/estimator.js'
import { createSession } from '../src/session/store.js'

describe('context estimator', () => {
  it('moves ratio toward the observed provider ratio with alpha .3', () => {
    const session = createSession('test', 'user')
    const raw = 100
    calibrate(session, 200, raw)
    expect(session.context?.calib).toEqual({ ratio: 1.3, samples: 1 })
    calibrate(session, 200, raw)
    calibrate(session, 200, raw)
    expect(session.context?.calib.ratio).toBeCloseTo(1.657, 3)
    expect(session.context?.calib.samples).toBe(3)
  })

  it('clamps absurd calibration inputs to the supported range', () => {
    const session = createSession('test', 'user')
    calibrate(session, -1, 100)
    expect(session.context?.calib.ratio).toBeGreaterThanOrEqual(0.5)
    calibrate(session, 100000, 1)
    expect(session.context?.calib.ratio).toBeLessThanOrEqual(3)
    calibrate(session, 100, 0)
    expect(session.context?.calib.ratio).toBeLessThanOrEqual(3)
  })

  it('uses raw tokens before calibration', () => {
    const messages = [{ role: 'user', content: 'hello' }]
    const session = createSession('test', 'user')
    expect(estimateTokens(messages)).toBe(rawTokens(messages))
    expect(estimateTokens(messages, session)).toBe(rawTokens(messages))
  })

  it('returns Infinity for an unknown model without a configured window', () => {
    const profile: any = {
      name: 'test',
      model: { id: 'unknown-model', base_url: 'https://example.com', api_key_env: 'KEY' },
    }
    expect(contextWindowFor(profile)).toBe(Infinity)
  })
})
