import { describe, it, expect } from 'vitest'
import { Ajv } from 'ajv'
import { parseJsonContract } from '../src/shared/json-contract.js'

const ajv = new Ajv()
const OUT = ajv.compile({ type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] })

describe('parseJsonContract', () => {
  it('parses bare JSON', () => {
    expect(parseJsonContract('{"findings":"x"}', OUT)).toEqual({ ok: true, value: { findings: 'x' } })
  })

  it('parses JSON wrapped in markdown fences', () => {
    expect(parseJsonContract('```json\n{"findings":"y"}\n```', OUT)).toEqual({ ok: true, value: { findings: 'y' } })
  })

  it('returns parse error with "non-JSON output" for unparseable text', () => {
    const r = parseJsonContract('plain text', OUT)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.kind).toBe('parse'); expect(r.error).toContain('non-JSON output') }
  })

  it('returns validation error with "output validation failed" for schema mismatch', () => {
    const r = parseJsonContract('{"wrong":1}', OUT)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.kind).toBe('validation'); expect(r.error).toContain('output validation failed') }
  })

  it('skips validation when no validator passed', () => {
    expect(parseJsonContract('{"anything":true}')).toEqual({ ok: true, value: { anything: true } })
  })
})
