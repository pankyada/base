import { describe, it, expect } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'

const BASE = {
  name: 'x',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'K', id: 'gpt-4o' },
  system_prompt: '/dev/null',
  artifact_dir: '/tmp',
}

describe('ProfileSchema contract block', () => {
  it('parses with no contract (undefined)', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.contract).toBeUndefined()
  })

  it('accepts a contract with input and output schemas', () => {
    const p = ProfileSchema.parse({
      ...BASE,
      contract: {
        input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
      },
    })
    expect(p.contract?.input).toBeDefined()
    expect(p.contract?.output).toBeDefined()
  })

  it('accepts a contract with only output', () => {
    const p = ProfileSchema.parse({ ...BASE, contract: { output: { type: 'object' } } })
    expect(p.contract?.input).toBeUndefined()
    expect(p.contract?.output).toBeDefined()
  })
})
