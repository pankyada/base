import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { listInstalled, listProposed, writeSkill, readSkill, discardSkill } from '../src/skills/manage.js'

function profile(artifact_dir: string): any {
  return { name: 'skills', artifact_dir, model: { id: 'gpt-4o', base_url: 'https://api.openai.com/v1', api_key_env: 'KEY' }, working_dir: artifact_dir }
}

describe('skills management', () => {
  it('lists installed skills from the session working directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'skills-session-cwd-'))
    const skillDir = join(cwd, '.agents', 'skills', 'session-cwd-marker')
    try {
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: session-cwd-marker\ndescription: Session-local skill\n---\n')
      expect(listInstalled(cwd).map(skill => skill.name)).toContain('session-cwd-marker')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('rejects traversal and validates frontmatter', () => {
    const p = profile(mkdtempSync(join(tmpdir(), 'skills-')))
    expect(() => writeSkill('../../etc', '---\nname: x\ndescription: y\n---', p)).toThrow(/invalid skill name/)
    expect(() => writeSkill('foo/bar', '---\nname: foo\ndescription: y\n---', p)).toThrow(/invalid skill name/)
    expect(() => writeSkill('safe', '# no frontmatter', p)).toThrow(/frontmatter/)
  })

  it('writes, lists, reads, and recoverably discards a proposal', () => {
    const p = profile(mkdtempSync(join(tmpdir(), 'skills-')))
    const content = '---\nname: safe\ndescription: Safe helper\n---\n\nDo thing.\n'
    const saved = writeSkill('safe', content, p)
    expect(saved.path).toContain('_proposed')
    expect(listProposed(p)[0].description).toBe('Safe helper')
    expect(readSkill('safe', 'proposed', p).content).toBe(content)
    const discarded = discardSkill('safe', p)
    expect(discarded.path).toContain('_discarded')
    expect(listProposed(p)).toEqual([])
  })
})
