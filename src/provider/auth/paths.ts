import { homedir } from 'node:os'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Runtime-owned Codex credential paths. Never reuse another app's store. */
export function codexAuthDir(home = homedir()): string { return join(home, '.harness', 'auth') }
export function codexAuthPath(home = homedir()): string { return join(codexAuthDir(home), 'openai-codex.json') }
export function codexAuthLockPath(home = homedir()): string { return join(codexAuthDir(home), 'openai-codex.lock') }

export function ensureCodexAuthDir(home = homedir()): string {
  const harnessDir = join(home, '.harness')
  ensureDirectory(harnessDir)
  const authDir = codexAuthDir(home)
  ensureDirectory(authDir)
  chmodSync(authDir, 0o700)
  return authDir
}

/** Read paths without creating directories or changing permissions. */
export function assertCodexAuthDirs(home = homedir()): void {
  for (const path of [join(home, '.harness'), codexAuthDir(home)]) {
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`refusing unsafe Codex auth directory: ${path}`)
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

function ensureDirectory(path: string): void {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`refusing unsafe Codex auth directory: ${path}`)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
    try { mkdirSync(path, { mode: 0o700 }) } catch (created: any) {
      if (created?.code !== 'EEXIST') throw created
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`refusing unsafe Codex auth directory: ${path}`)
    }
  }
}
