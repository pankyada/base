import { describe, it, expect } from 'vitest'
import { compileContract, validateAndBuildInput, processOutput } from '../src/server/contract.js'
import type { Profile } from '../src/profiles/schema.js'

function profileWith(contract?: any): Profile {
  return { name: 'p', contract } as unknown as Profile
}

describe('compileContract', () => {
  it('returns empty compiled contract when profile has none', () => {
    expect(compileContract(profileWith())).toEqual({})
  })
})

describe('validateAndBuildInput', () => {
  it('requires a string when there is no input schema and passes it through', () => {
    const c = compileContract(profileWith())
    const r = validateAndBuildInput('hello', c)
    expect(r).toEqual({ ok: true, userMessage: 'hello' })
  })

  it('rejects a non-string when there is no input schema', () => {
    const c = compileContract(profileWith())
    const r = validateAndBuildInput({ a: 1 }, c)
    expect(r.ok).toBe(false)
  })

  it('validates object input against input schema and appends output instruction', () => {
    const c = compileContract(profileWith({
      input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
    }))
    const r = validateAndBuildInput({ query: 'hi' }, c)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.userMessage).toContain('"query": "hi"')
      expect(r.userMessage).toContain('Respond with a JSON object matching this schema')
    }
  })

  it('returns details when object input fails the input schema', () => {
    const c = compileContract(profileWith({
      input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }))
    const r = validateAndBuildInput({ wrong: 1 }, c)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.error).toContain('input validation failed'); expect(r.details).toBeDefined() }
  })

  it('appends output instruction to a string when only output schema exists', () => {
    const c = compileContract(profileWith({ output: { type: 'object' } }))
    const r = validateAndBuildInput('do it', c)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.userMessage).toContain('do it'); expect(r.userMessage).toContain('Respond with a JSON object') }
  })
})

describe('processOutput', () => {
  it('returns freeform text when no output schema', () => {
    const c = compileContract(profileWith())
    expect(processOutput('just text', c)).toEqual({ ok: true, output: 'just text' })
  })

  it('parses and validates JSON output against output schema', () => {
    const c = compileContract(profileWith({ output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] } }))
    expect(processOutput('{"findings":"ok"}', c)).toEqual({ ok: true, output: { findings: 'ok' } })
  })

  it('fails when output does not match schema', () => {
    const c = compileContract(profileWith({ output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] } }))
    const r = processOutput('{"wrong":1}', c)
    expect(r.ok).toBe(false)
  })
})
