import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { loadSkillsFromDir, loadAllSkills, resolveSkillsDirs } from '../src/skills/loader.js'
import { buildSkillIndex } from '../src/skills/indexer.js'

// Helper: create a skill directory with SKILL.md
function makeSkillDir(root: string, skillName: string, name: string, description: string) {
  const skillDir = join(root, skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nContent here.`)
  return skillDir
}

describe('loadSkillsFromDir', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'skills-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('loads a skill from a subdirectory containing SKILL.md', () => {
    makeSkillDir(root, 'my-skill', 'my-skill', 'does the thing')
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('my-skill')
    expect(skills[0].description).toBe('does the thing')
    expect(skills[0].filePath).toContain('SKILL.md')
  })

  it('skips subdirectories with no SKILL.md', () => {
    mkdirSync(join(root, 'empty-dir'))
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(0)
  })

  it('skips SKILL.md missing name or description frontmatter', () => {
    const d = join(root, 'bad-skill')
    mkdirSync(d)
    writeFileSync(join(d, 'SKILL.md'), `---\nname: only-name\n---\n# content`)
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(0)
  })

  it('ignores regular .md files at root level (not inside subdirs)', () => {
    writeFileSync(join(root, 'flat.md'), `---\nname: flat\ndescription: flat skill\n---`)
    const skills = loadSkillsFromDir(root)
    expect(skills).toHaveLength(0)
  })

  it('returns empty array for non-existent directory', () => {
    const skills = loadSkillsFromDir('/nonexistent/path/that/does/not/exist')
    expect(skills).toHaveLength(0)
  })
})

describe('loadAllSkills', () => {
  let dir1: string, dir2: string
  beforeEach(() => {
    dir1 = mkdtempSync(join(tmpdir(), 'skills-a-'))
    dir2 = mkdtempSync(join(tmpdir(), 'skills-b-'))
  })
  afterEach(() => {
    rmSync(dir1, { recursive: true, force: true })
    rmSync(dir2, { recursive: true, force: true })
  })

  it('later dir overrides earlier on name collision (most-specific wins)', () => {
    makeSkillDir(dir1, 'shared', 'shared', 'global version')
    makeSkillDir(dir2, 'shared', 'shared', 'local version')
    const skills = loadAllSkills([dir1, dir2])
    expect(skills).toHaveLength(1)
    expect(skills[0].description).toBe('local version')
  })

  it('merges unique skills from multiple dirs', () => {
    makeSkillDir(dir1, 'skill-a', 'skill-a', 'from dir1')
    makeSkillDir(dir2, 'skill-b', 'skill-b', 'from dir2')
    const skills = loadAllSkills([dir1, dir2])
    expect(skills).toHaveLength(2)
  })

  it('handles empty dirs array', () => {
    expect(loadAllSkills([])).toEqual([])
  })
})

describe('resolveSkillsDirs', () => {
  it('returns an array of strings', () => {
    const dirs = resolveSkillsDirs()
    expect(Array.isArray(dirs)).toBe(true)
    dirs.forEach(d => expect(typeof d).toBe('string'))
  })

  it('includes ~/.agents/skills as first entry', () => {
    const dirs = resolveSkillsDirs()
    expect(dirs[0]).toBe(join(homedir(), '.agents', 'skills'))
  })

  it('returns no duplicate paths', () => {
    const dirs = resolveSkillsDirs()
    expect(new Set(dirs).size).toBe(dirs.length)
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
