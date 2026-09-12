import { realpathSync, statSync } from 'fs'
import { isAbsolute, resolve } from 'path'

const MAX_WORKING_DIR_LENGTH = 4096

/** Resolve an optional client directory. Explicit client values must be absolute existing directories. */
export function resolveSessionWorkingDir(requested: unknown, fallback: string): string {
  if (requested === undefined) {
    const absoluteFallback = resolve(fallback || process.cwd())
    try {
      const canonicalFallback = realpathSync(absoluteFallback)
      return statSync(canonicalFallback).isDirectory() ? canonicalFallback : absoluteFallback
    } catch {
      return absoluteFallback
    }
  }

  if (typeof requested !== 'string' || requested.length === 0 || requested.length > MAX_WORKING_DIR_LENGTH || requested.includes('\0') || !isAbsolute(requested)) {
    throw new Error('invalid working directory')
  }
  try {
    const canonical = realpathSync(requested)
    if (!statSync(canonical).isDirectory()) throw new Error('not a directory')
    return canonical
  } catch {
    throw new Error('invalid working directory')
  }
}
