import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the message parsing logic extracted to a pure helper
import { parseServerMessage } from '../../src/tui/hooks/use-ws.js'

describe('parseServerMessage', () => {
  it('parses token message', () => {
    const result = parseServerMessage('{"type":"token","content":"hello"}')
    expect(result).toEqual({ type: 'token', content: 'hello' })
  })

  it('parses stats message', () => {
    const result = parseServerMessage('{"type":"stats","tokens_in":100,"tokens_out":20,"cost_usd":0.001}')
    expect(result).toEqual({ type: 'stats', tokens_in: 100, tokens_out: 20, cost_usd: 0.001 })
  })

  it('returns null for invalid JSON', () => {
    const result = parseServerMessage('not-json')
    expect(result).toBeNull()
  })
})
