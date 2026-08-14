import matter from 'gray-matter'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { resolveSkillsDirs } from './loader.js'

export interface CustomCommand {
  name: string
  description: string
  template: string
  filePath: string
}

export interface CommandSummary {
  name: string
  description: string
  template: string
}

// Commands follow the exact four-level order used by skills. Mapping the
// sibling directory keeps discovery precedence in one place: later, more
// specific roots overwrite earlier names.
export function resolveCommandDirs(): string[] {
  const seen = new Set<string>()
  return resolveSkillsDirs()
    .map(dir => resolve(dir, '..', 'commands'))
    .filter(dir => {
      if (seen.has(dir)) return false
      seen.add(dir)
      return true
    })
}

export function loadCommandsFromDir(dir: string): CustomCommand[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(dir, entry.name))
    .flatMap(filePath => {
      try {
        const raw = readFileSync(filePath, 'utf-8')
        const { data, content } = matter(raw)
        if (typeof data.name !== 'string' || typeof data.description !== 'string' || !data.name || !data.description) return []
        return [{
          name: data.name,
          description: data.description,
          template: content.trim(),
          filePath,
        } satisfies CustomCommand]
      } catch {
        return []
      }
    })
}

export function loadAllCommands(dirs: string[]): CustomCommand[] {
  const byName = new Map<string, CustomCommand>()
  for (const dir of dirs) {
    for (const command of loadCommandsFromDir(dir)) {
      byName.set(command.name, command)
    }
  }
  return [...byName.values()]
}

export function commandSummaries(commands: CustomCommand[]): CommandSummary[] {
  return commands.map(({ name, description, template }) => ({ name, description, template }))
}
