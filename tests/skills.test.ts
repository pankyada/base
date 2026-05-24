import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadSkillsFromDir, loadAllSkills } from '../src/skills/loader.js'
import { buildSkillIndex } from '../src/skills/indexer.js'

describe('skill loader', () => {
  it('loads skills from directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-'))
    writeFileSync(join(dir, 'foo.md'), `---\nname: foo\ndescription: does foo\n---\n# Foo\nDo the foo thing.`)
    const skills = loadSkillsFromDir(dir)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('foo')
    expect(skills[0].description).toBe('does foo')
  })

  it('skips files starting with _', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills2-'))
    writeFileSync(join(dir, '_proposed.md'), `---\nname: draft\ndescription: draft\n---`)
    const skills = loadSkillsFromDir(dir)
    expect(skills).toHaveLength(0)
  })

  it('later dir overrides earlier (project-local wins)', () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'skills3a-'))
    const dir2 = mkdtempSync(join(tmpdir(), 'skills3b-'))
    writeFileSync(join(dir1, 'shared.md'), `---\nname: shared\ndescription: global\n---`)
    writeFileSync(join(dir2, 'shared.md'), `---\nname: shared\ndescription: local\n---`)
    const skills = loadAllSkills([dir1, dir2])
    expect(skills).toHaveLength(1)
    expect(skills[0].description).toBe('local')
  })
})

describe('buildSkillIndex', () => {
  it('builds index string from skills', () => {
    const index = buildSkillIndex([{ name: 'foo', description: 'does foo', content: '', filePath: '' }])
    expect(index).toContain('foo')
    expect(index).toContain('does foo')
  })

  it('returns empty string when no skills', () => {
    expect(buildSkillIndex([])).toBe('')
  })
})
