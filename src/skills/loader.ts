import matter from 'gray-matter'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { Skill } from '../tools/types.js'

export { Skill }

export function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .map(f => {
      const filePath = join(dir, f)
      const raw = readFileSync(filePath, 'utf-8')
      const { data } = matter(raw)
      return {
        name: data.name as string,
        description: data.description as string,
        content: raw,
        filePath,
      }
    })
    .filter(s => s.name && s.description)
}

export function loadAllSkills(skillsDirs: string[]): Skill[] {
  const byName = new Map<string, Skill>()
  for (const dir of skillsDirs) {
    for (const skill of loadSkillsFromDir(dir)) {
      byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}
