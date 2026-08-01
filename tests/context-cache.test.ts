import { describe, expect, it } from 'vitest'
import { applyCacheBreakpoints } from '../src/context/cache.js'

describe('context cache breakpoints', () => {
  const messages = [
    { role: 'system', content: 'prefix' },
    { role: 'user', content: '[Earlier session digest: digest]' },
    { role: 'user', content: 'live' },
  ]

  it('leaves projection byte-identical when cache is disabled', () => {
    expect(applyCacheBreakpoints(messages, false)).toEqual(messages)
    expect(JSON.stringify(applyCacheBreakpoints(messages, false))).toBe(JSON.stringify(messages))
  })

  it('marks only the end of prefix and end of digest', () => {
    const result: any[] = applyCacheBreakpoints(messages, true) as any[]
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(result[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(result[2].cache_control).toBeUndefined()
  })
})
