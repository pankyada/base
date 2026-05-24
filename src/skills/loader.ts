import matter from 'gray-matter'
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import type { Skill } from '../tools/types.js'

export type { Skill }

function getGitRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { stdio: 'pipe' })
      .toString()
      .trim()
  } catch {
    return null
  }
}

export function resolveSkillsDirs(): string[] {
  const cwd = process.cwd()
  const candidates: string[] = [
    join(homedir(), '.agents', 'skills'),
  ]
  const gitRoot = getGitRoot()
  if (gitRoot) candidates.push(join(gitRoot, '.agents', 'skills'))
  candidates.push(join(resolve(cwd, '..'), '.agents', 'skills'))
  candidates.push(join(cwd, '.agents', 'skills'))

  const seen = new Set<string>()
  return candidates.filter(p => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

export function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(entry => statSync(join(dir, entry)).isDirectory())
    .flatMap(entry => {
      const skillMd = join(dir, entry, 'SKILL.md')
      if (!existsSync(skillMd)) return []
      const raw = readFileSync(skillMd, 'utf-8')
      const { data } = matter(raw)
      const name = data.name as string | undefined
      const description = data.description as string | undefined
      if (!name || !description) return []
      return [{
        name,
        description,
        content: raw,
        filePath: skillMd,
      } satisfies Skill]
    })
}

export function loadAllSkills(dirs: string[]): Skill[] {
  const byName = new Map<string, Skill>()
  for (const dir of dirs) {
    for (const skill of loadSkillsFromDir(dir)) {
      byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}
