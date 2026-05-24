import { describe, it, expect } from 'vitest'
import { getAcl, getMcpAcl } from '../src/tools/acl.js'
import { Profile } from '../src/profiles/schema.js'

const baseProfile = {
  name: 'test', model: { base_url: 'https://api.openai.com/v1', api_key_env: 'X', id: 'gpt-4o' },
  system_prompt: '/tmp/p.md', working_dir: '/tmp', artifact_dir: '/tmp/art',
  tools: {
    builtin: { Read: 'allow', Bash: 'prompt', Write: 'deny' } as any,
    mcp_servers: [{ name: 'pg', command: 'pg-mcp', args: [], env: {}, acl: { '*': 'prompt', query: 'allow' } as any }],
  },
  hooks: { pre_tool: [], post_tool: [], on_stop: [] },
  improvement: { enabled: false, mine_skills_every_n_sessions: 10 },
} satisfies Profile

describe('getAcl', () => {
  it('returns allow for Read', () => expect(getAcl('Read', baseProfile)).toBe('allow'))
  it('returns prompt for Bash', () => expect(getAcl('Bash', baseProfile)).toBe('prompt'))
  it('returns deny for Write', () => expect(getAcl('Write', baseProfile)).toBe('deny'))
  it('returns prompt for unknown tool', () => expect(getAcl('Unknown', baseProfile)).toBe('prompt'))
})

describe('getMcpAcl', () => {
  it('returns allow for exact match', () => expect(getMcpAcl('pg', 'query', baseProfile)).toBe('allow'))
  it('returns wildcard for unmatched', () => expect(getMcpAcl('pg', 'insert', baseProfile)).toBe('prompt'))
  it('returns deny for unknown server', () => expect(getMcpAcl('unknown', 'x', baseProfile)).toBe('deny'))
})
