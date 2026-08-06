import { existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import type { VoiceProvider } from './types.js'

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() && /\.(m?js|ts)$/.test(entry.name) ? [path] : []
  })
}

function isProvider(value: unknown): value is VoiceProvider {
  const item = value as Partial<VoiceProvider> | null
  return Boolean(item && typeof item.name === 'string' && (item.stt || item.tts))
}

export function resolveVoiceDirs(): string[] {
  return [...new Set([join(homedir(), '.agents', 'voice'), join(process.cwd(), '.agents', 'voice'), join(resolve(process.cwd(), '..'), '.agents', 'voice')])]
}

export async function loadVoiceProviders(dirs = resolveVoiceDirs()): Promise<VoiceProvider[]> {
  const found = new Map<string, VoiceProvider>()
  for (const dir of dirs) for (const path of filesUnder(dir)) {
    try {
      const mod = await import(pathToFileURL(path).href)
      for (const value of [mod.default, ...Object.values(mod)]) if (isProvider(value)) found.set(value.name, value)
    } catch (error: any) { console.error(`[voice] failed to load ${path}: ${error.message}`) }
  }
  return [...found.values()]
}
