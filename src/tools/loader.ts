import { readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'
import type { ToolDefinition } from './types.js'

let _gitRootCached: string | null | undefined = undefined

function getGitRoot(): string | null {
  if (_gitRootCached !== undefined) return _gitRootCached
  try {
    _gitRootCached = execSync('git rev-parse --show-toplevel', { stdio: 'pipe', timeout: 3000 })
      .toString()
      .trim()
  } catch {
    _gitRootCached = null
  }
  return _gitRootCached
}

export function resolveToolsDirs(): string[] {
  const cwd = process.cwd()
  const candidates: string[] = [
    join(homedir(), '.agents', 'tools'),
  ]
  const gitRoot = getGitRoot()
  if (gitRoot) candidates.push(join(gitRoot, '.agents', 'tools'))
  candidates.push(join(resolve(cwd, '..'), '.agents', 'tools'))
  candidates.push(join(cwd, '.agents', 'tools'))

  const seen = new Set<string>()
  return candidates.filter(p => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

function isToolDefinition(obj: any): obj is ToolDefinition {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.parameters === 'object' &&
    typeof obj.execute === 'function'
  )
}

export async function loadToolsFromDir(dir: string): Promise<ToolDefinition[]> {
  if (!existsSync(dir)) return []

  const tools: ToolDefinition[] = []
  const files = readdirSync(dir, { withFileTypes: true })

  for (const entry of files) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
      try {
        const filePath = join(dir, entry.name)
        // Ensure to use file URL for dynamic imports on Windows and absolute paths
        const fileUrl = pathToFileURL(filePath).href
        const mod = await import(fileUrl)

        // Try default export first
        if (isToolDefinition(mod.default)) {
          tools.push(mod.default)
        } else {
          // Check all named exports
          for (const key of Object.keys(mod)) {
            if (isToolDefinition(mod[key])) {
              tools.push(mod[key])
            }
          }
        }
      } catch (e: any) {
        console.error(`[tools] Failed to load tool from ${entry.name}: ${e.message}`)
      }
    }
  }

  return tools
}

export async function loadAllCustomTools(dirs: string[]): Promise<ToolDefinition[]> {
  const byName = new Map<string, ToolDefinition>()
  for (const dir of dirs) {
    const tools = await loadToolsFromDir(dir)
    for (const tool of tools) {
      // Last write wins (most specific directory wins based on array order)
      byName.set(tool.name, tool)
    }
  }
  return [...byName.values()]
}
