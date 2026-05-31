import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export interface BootstrapResult {
  spawnedByUs: boolean
  cleanup: () => void
}

async function probeHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.status === 200
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function findRepoRoot(fromPath: string): string {
  let dir = dirname(fromPath)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = dirname(dir)
  }
  // Fallback: find any package.json
  dir = dirname(fromPath)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  return dir
}

export function resolveServerCommand(isDev?: boolean): { command: string; args: string[] } {
  const thisFile = fileURLToPath(import.meta.url)
  const repoRoot = findRepoRoot(thisFile)
  const dev = isDev ?? existsSync(join(repoRoot, 'src', 'server', 'index.ts'))

  if (dev) {
    return { command: 'tsx', args: [join(repoRoot, 'src', 'server', 'index.ts')] }
  } else {
    const dir = dirname(thisFile)
    return { command: join(dir, 'harness-server'), args: [] }
  }
}

export async function ensureServer(port: number): Promise<BootstrapResult> {
  if (await probeHealth(port)) {
    return { spawnedByUs: false, cleanup: () => {} }
  }

  const { command, args } = resolveServerCommand()
  const child = spawn(command, args, {
    env: { ...process.env, HARNESS_PORT: String(port) },
    stdio: 'ignore',
    detached: false,
  })

  child.on?.('error', () => { /* swallow — timeout loop will surface it */ })

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    await sleep(250)
    if (await probeHealth(port)) {
      const cleanup = () => {
        let killTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          killTimer = null
          try { child.kill('SIGKILL') } catch { /* already dead */ }
        }, 2000)
        child.on?.('exit', () => {
          if (killTimer) { clearTimeout(killTimer); killTimer = null }
        })
        child.kill('SIGTERM')
      }
      return { spawnedByUs: true, cleanup }
    }
  }

  child.kill('SIGKILL')
  throw new Error(
    `harness server failed to become healthy within 10s on port ${port} — ` +
    `check that '${command}' is on your PATH and the profile is valid`
  )
}
