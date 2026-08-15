import matter from 'gray-matter'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import type { Skill } from '../tools/types.js'

export type { Skill }

const _gitRootCached = new Map<string, string | null>()

export function getGitRoot(cwd = process.cwd()): string | null {
  const cached = _gitRootCached.get(cwd)
  if (cached !== undefined) return cached
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, stdio: 'pipe', timeout: 3000 })
      .toString()
      .trim()
    _gitRootCached.set(cwd, root)
    return root
  } catch {
    _gitRootCached.set(cwd, null)
    return null
  }
}

export function resolveSkillsDirs(cwd = process.cwd()): string[] {
  const candidates: string[] = [
    join(homedir(), '.agents', 'skills'),
  ]
  const gitRoot = getGitRoot(cwd)
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
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .flatMap(entry => {
      const skillMd = join(dir, entry, 'SKILL.md')
      if (!existsSync(skillMd)) return []
      try {
        const raw = readFileSync(skillMd, 'utf-8')
        const { data } = matter(raw)
        const name = data.name
        const description = data.description
        if (!name || !description || typeof name !== 'string' || typeof description !== 'string') return []
        return [{
          name,
          description,
          content: raw,
          filePath: skillMd,
        } satisfies Skill]
      } catch {
        return []
      }
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
