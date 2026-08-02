import { existsSync, readdirSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import type { ChannelAdapter } from './types.js'

let gitRoot: string | null | undefined

function getGitRoot(): string | null {
  if (gitRoot !== undefined) return gitRoot
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', { stdio: 'pipe', timeout: 3000 }).toString().trim()
  } catch {
    gitRoot = null
  }
  return gitRoot
}

export function resolveChannelsDirs(): string[] {
  const candidates = [join(homedir(), '.agents', 'channels')]
  const root = getGitRoot()
  if (root) candidates.push(join(root, '.agents', 'channels'))
  candidates.push(join(resolve(process.cwd(), '..'), '.agents', 'channels'))
  candidates.push(join(process.cwd(), '.agents', 'channels'))
  return [...new Set(candidates)]
}

function isChannelAdapter(value: unknown): value is ChannelAdapter {
  const item = value as Partial<ChannelAdapter> | null
  return Boolean(item && typeof item.name === 'string' && item.capabilities &&
    typeof item.init === 'function' && typeof item.send === 'function' &&
    typeof item.start === 'function' && typeof item.stop === 'function')
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...filesUnder(path))
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) result.push(path)
  }
  return result
}

export async function loadChannelsFromDir(dir: string): Promise<ChannelAdapter[]> {
  const adapters: ChannelAdapter[] = []
  for (const filePath of filesUnder(dir)) {
    try {
      const mod = await import(pathToFileURL(filePath).href)
      const values = [mod.default, ...Object.values(mod)]
      for (const value of values) {
        if (isChannelAdapter(value)) adapters.push(value)
      }
    } catch (error: any) {
      console.error(`[channels] failed to load ${filePath}: ${error.message}`)
    }
  }
  return adapters
}

export async function loadAllCustomChannels(dirs: string[]): Promise<ChannelAdapter[]> {
  const byName = new Map<string, ChannelAdapter>()
  for (const dir of dirs) {
    for (const adapter of await loadChannelsFromDir(dir)) byName.set(adapter.name, adapter)
  }
  return [...byName.values()]
}

