import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { loadProfile } from '../src/profiles/loader.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

describe('devops profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/devops.yaml')) })

  it('name is devops', () => { expect(profile.name).toBe('devops') })
  it('model id is claude-sonnet-4-6', () => { expect(profile.model.id).toBe('claude-sonnet-4-6') })
  it('api_key_env is ANTHROPIC_API_KEY', () => { expect(profile.model.api_key_env).toBe('ANTHROPIC_API_KEY') })
  it('Bash is allow', () => { expect(profile.tools.builtin.Bash).toBe('allow') })
  it('ExecuteCode is deny', () => { expect(profile.tools.builtin.ExecuteCode).toBe('deny') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('cron trigger fires at 08:00 daily', () => { expect(profile.triggers?.cron).toBe('0 8 * * *') })
  it('cron_input has a task string', () => {
    expect(typeof (profile.triggers?.cron_input as any)?.task).toBe('string')
  })
  it('has 2 MCP servers named github and logs', () => {
    const names = profile.tools.mcp_servers.map(s => s.name)
    expect(names).toContain('github')
    expect(names).toContain('logs')
  })
})

describe('research profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/research.yaml')) })

  it('name is research', () => { expect(profile.name).toBe('research') })
  it('model id is claude-opus-4-8', () => { expect(profile.model.id).toBe('claude-opus-4-8') })
  it('Delegate is allow', () => { expect(profile.tools.builtin.Delegate).toBe('allow') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Write is deny', () => { expect(profile.tools.builtin.Write).toBe('deny') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('has 2 sub-agents named researcher and summariser', () => {
    const names = (profile.agents ?? []).map(a => a.name)
    expect(names).toContain('researcher')
    expect(names).toContain('summariser')
  })
  it('researcher agent input requires query field', () => {
    const agent = (profile.agents ?? []).find(a => a.name === 'researcher')!
    expect((agent.input as any).required).toContain('query')
  })
  it('summariser agent input requires findings field', () => {
    const agent = (profile.agents ?? []).find(a => a.name === 'summariser')!
    expect((agent.input as any).required).toContain('findings')
  })
  it('has 2 MCP servers named fetch and brave-search', () => {
    const names = profile.tools.mcp_servers.map(s => s.name)
    expect(names).toContain('fetch')
    expect(names).toContain('brave-search')
  })
})

describe('researcher worker profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/researcher.yaml')) })

  it('name is researcher', () => { expect(profile.name).toBe('researcher') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Write is deny', () => { expect(profile.tools.builtin.Write).toBe('deny') })
  it('Edit is deny', () => { expect(profile.tools.builtin.Edit).toBe('deny') })
  it('Delegate is deny', () => { expect(profile.tools.builtin.Delegate).toBe('deny') })
  it('Read is allow', () => { expect(profile.tools.builtin.Read).toBe('allow') })
  it('improvement is disabled', () => { expect(profile.improvement.enabled).toBe(false) })
})

describe('summariser worker profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/summariser.yaml')) })

  it('name is summariser', () => { expect(profile.name).toBe('summariser') })
  it('Write is allow', () => { expect(profile.tools.builtin.Write).toBe('allow') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Delegate is deny', () => { expect(profile.tools.builtin.Delegate).toBe('deny') })
  it('no MCP servers', () => { expect(profile.tools.mcp_servers).toHaveLength(0) })
  it('improvement is disabled', () => { expect(profile.improvement.enabled).toBe(false) })
})

describe('writer profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/writer.yaml')) })

  it('name is writer', () => { expect(profile.name).toBe('writer') })
  it('model id is claude-sonnet-4-6', () => { expect(profile.model.id).toBe('claude-sonnet-4-6') })
  it('Write is allow', () => { expect(profile.tools.builtin.Write).toBe('allow') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Edit is deny', () => { expect(profile.tools.builtin.Edit).toBe('deny') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('no MCP servers', () => { expect(profile.tools.mcp_servers).toHaveLength(0) })
  it('contract input requires topic and format', () => {
    const input = profile.contract?.input as any
    expect(input?.required).toContain('topic')
    expect(input?.required).toContain('format')
  })
  it('contract input format enum contains blog changelog email docs', () => {
    const input = profile.contract?.input as any
    expect(input?.properties?.format?.enum).toEqual(['blog', 'changelog', 'email', 'docs'])
  })
  it('on_stop hook stages drafts with git add', () => {
    expect(profile.hooks.on_stop).toHaveLength(1)
    expect(profile.hooks.on_stop[0]).toContain('git add')
    expect(profile.hooks.on_stop[0]).toContain('.harness/writer/drafts')
  })
})

describe('security profile', () => {
  let profile: ReturnType<typeof loadProfile>
  beforeAll(() => { profile = loadProfile(resolve(ROOT, 'profiles/security.yaml')) })

  it('name is security', () => { expect(profile.name).toBe('security') })
  it('model id is claude-opus-4-8', () => { expect(profile.model.id).toBe('claude-opus-4-8') })
  it('Bash is deny', () => { expect(profile.tools.builtin.Bash).toBe('deny') })
  it('Write is deny', () => { expect(profile.tools.builtin.Write).toBe('deny') })
  it('Edit is deny', () => { expect(profile.tools.builtin.Edit).toBe('deny') })
  it('ExecuteCode is deny', () => { expect(profile.tools.builtin.ExecuteCode).toBe('deny') })
  it('Grep is allow', () => { expect(profile.tools.builtin.Grep).toBe('allow') })
  it('Skill is allow', () => { expect(profile.tools.builtin.Skill).toBe('allow') })
  it('mode is undefined', () => { expect(profile.mode).toBeUndefined() })
  it('webhook trigger is enabled', () => { expect(profile.triggers?.webhook).toBe(true) })
  it('contract input requires repo_path and commit_sha', () => {
    const input = profile.contract?.input as any
    expect(input?.required).toContain('repo_path')
    expect(input?.required).toContain('commit_sha')
  })
  it('has 1 MCP server named codebase', () => {
    expect(profile.tools.mcp_servers).toHaveLength(1)
    expect(profile.tools.mcp_servers[0].name).toBe('codebase')
  })
})

describe('skill files exist with valid frontmatter', () => {
  const skills = [
    '.agents/skills/devops/incident-runbook/SKILL.md',
    '.agents/skills/devops/rollback-checklist/SKILL.md',
    '.agents/skills/research/extract-claims/SKILL.md',
    '.agents/skills/writer/changelog-generator/SKILL.md',
    '.agents/skills/security/vuln-patterns/SKILL.md',
    '.agents/skills/security/audit-report-template/SKILL.md',
  ]

  for (const rel of skills) {
    it(`${rel} exists and has name + description frontmatter`, () => {
      const full = resolve(ROOT, rel)
      expect(existsSync(full), `missing: ${full}`).toBe(true)
      const content = readFileSync(full, 'utf-8')
      expect(content).toMatch(/^---/)
      expect(content).toMatch(/name:/)
      expect(content).toMatch(/description:/)
    })
  }
})
