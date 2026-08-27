import { describe, expect, it } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'
import { buildAgentCatalog } from '../src/agents/catalog.js'

const base = {
  name: 'orchestrator',
  model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
  system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
}

describe('operator spawn contract', () => {
  it('accepts spawn metadata without changing model input schemas', () => {
    const input = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    const profile = ProfileSchema.parse({ ...base, agents: [{
      name: 'researcher', profile: '/tmp/research.yaml', input, output: { type: 'object' },
      spawn: { label: 'Research', hint: 'Find evidence', prompt_field: 'query', example: { query: 'topic' }, max_concurrent: 2, budget_usd: 0.5 },
    }] })
    expect(profile.agents[0].input).toEqual(input)
    expect(profile.agents[0].spawn).toEqual({ label: 'Research', hint: 'Find evidence', prompt_field: 'query', example: { query: 'topic' }, max_concurrent: 2, budget_usd: 0.5 })
  })

  it('builds catalog from named agents and discoverable profiles', () => {
    const profile = { ...base, agents: [{ name: 'researcher', profile: '/tmp/research.yaml', input: { type: 'object' }, output: { type: 'object' }, spawn: { prompt_field: 'query' } }] } as any
    const catalog = buildAgentCatalog(profile, [
      { ...base, name: 'orchestrator' },
      { ...base, name: 'writer', description: 'Writes answers' },
    ] as any)
    expect(catalog).toEqual([
      expect.objectContaining({ name: 'researcher', prompt_field: 'query' }),
      expect.objectContaining({ name: 'writer', profile: 'writer', prompt_field: 'task' }),
    ])
  })
})
