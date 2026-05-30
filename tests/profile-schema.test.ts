import { describe, it, expect } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'

const BASE = {
  name: 'test',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
  system_prompt: './prompt.md',
  artifact_dir: '/tmp/test',
}

describe('ProfileSchema – agents + max_depth', () => {
  it('defaults max_depth to 2 and agents to [] when absent', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.max_depth).toBe(2)
    expect(p.agents).toEqual([])
  })

  it('accepts a custom max_depth', () => {
    const p = ProfileSchema.parse({ ...BASE, max_depth: 3 })
    expect(p.max_depth).toBe(3)
  })

  it('parses a well-formed agents block', () => {
    const p = ProfileSchema.parse({
      ...BASE,
      agents: [
        {
          name: 'researcher',
          profile: './profiles/researcher.yaml',
          input: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          output: {
            type: 'object',
            properties: { findings: { type: 'string' } },
            required: ['findings'],
          },
        },
      ],
    })
    expect(p.agents).toHaveLength(1)
    expect(p.agents[0].name).toBe('researcher')
    expect(p.agents[0].profile).toBe('./profiles/researcher.yaml')
    expect((p.agents[0].input as any).properties.query.type).toBe('string')
  })

  it('rejects an agent entry missing required input field', () => {
    expect(() =>
      ProfileSchema.parse({
        ...BASE,
        agents: [{ name: 'bad', profile: './p.yaml', output: { type: 'object' } }],
      })
    ).toThrow()
  })
})

describe('ProfileSchema – triggers block', () => {
  it('triggers defaults to undefined when absent', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.triggers).toBeUndefined()
  })

  it('parses triggers.cron expression', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { cron: '0 9 * * *' } })
    expect(p.triggers?.cron).toBe('0 9 * * *')
    expect(p.triggers?.webhook).toBe(false)
  })

  it('parses triggers.webhook true', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { webhook: true } })
    expect(p.triggers?.webhook).toBe(true)
  })

  it('parses triggers.cron_input payload', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { cron: '* * * * *', cron_input: { task: 'run' } } })
    expect(p.triggers?.cron_input).toEqual({ task: 'run' })
  })

  it('triggers.webhook defaults to false when only cron is set', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { cron: '* * * * *' } })
    expect(p.triggers?.webhook).toBe(false)
  })
})

describe('ProfileSchema – description + interop', () => {
  it('description defaults to undefined when absent', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.description).toBeUndefined()
  })

  it('parses a description string', () => {
    const p = ProfileSchema.parse({ ...BASE, description: 'A helpful agent' })
    expect(p.description).toBe('A helpful agent')
  })

  it('interop defaults to undefined when absent', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.interop).toBeUndefined()
  })

  it('parses interop.a2a: true', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: { a2a: true } })
    expect(p.interop?.a2a).toBe(true)
  })

  it('interop.a2a defaults to false when not set', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: {} })
    expect(p.interop?.a2a).toBe(false)
  })
})

describe('ProfileSchema – interop.acp', () => {
  it('interop.acp defaults to false when interop block is present without acp', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: { a2a: true } })
    expect(p.interop?.acp).toBe(false)
  })

  it('parses interop.acp: true', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: { acp: true } })
    expect(p.interop?.acp).toBe(true)
  })

  it('interop.a2a and interop.acp can both be true', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: { a2a: true, acp: true } })
    expect(p.interop?.a2a).toBe(true)
    expect(p.interop?.acp).toBe(true)
  })
})
