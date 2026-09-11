import { spawn } from 'child_process'
import { Profile } from '../profiles/schema.js'

export type HookType = 'pre_tool' | 'post_tool' | 'on_stop'
const MAX_HOOK_OUTPUT = 1_048_576

function abortedError(stderr = ''): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR', stderr })
}

function runHookCommand(command: string, env: Record<string, string>, timeout: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  if (signal?.aborted) return Promise.reject(abortedError())
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let forceKillTimer: NodeJS.Timeout | undefined
    const proc = spawn(command, {
      shell: true,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const appendOutput = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_HOOK_OUTPUT) return current
      return current + chunk.toString().slice(0, MAX_HOOK_OUTPUT - current.length)
    }
    const killProcessGroup = (signalName: NodeJS.Signals) => {
      if (process.platform !== 'win32' && proc.pid) {
        try { process.kill(-proc.pid, signalName) } catch { /* process already exited */ }
      } else {
        proc.kill(signalName)
      }
    }
    const cleanup = () => {
      clearTimeout(timeoutTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      signal?.removeEventListener('abort', abort)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve({ stdout, stderr })
    }
    const abort = () => {
      if (settled || aborted) return
      aborted = true
      killProcessGroup('SIGTERM')
      forceKillTimer = setTimeout(() => {
        killProcessGroup('SIGKILL')
        finish(abortedError(stderr))
      }, 250)
    }
    const timeoutTimer = setTimeout(() => {
      if (settled || timedOut) return
      timedOut = true
      killProcessGroup('SIGTERM')
      forceKillTimer = setTimeout(() => {
        killProcessGroup('SIGKILL')
        const error = Object.assign(new Error(`Command timed out after ${timeout}ms`), { killed: true, code: 'ETIMEDOUT' })
        finish(error)
      }, 250)
    }, timeout)
    proc.stdout.on('data', (data: Buffer) => { stdout = appendOutput(stdout, data) })
    proc.stderr.on('data', (data: Buffer) => { stderr = appendOutput(stderr, data) })
    proc.once('error', error => { if (!settled && !aborted && !timedOut) finish(Object.assign(error, { stderr })) })
    proc.once('close', code => {
      if (settled) return
      if (aborted) {
        killProcessGroup('SIGKILL')
        return finish(abortedError(stderr))
      }
      if (timedOut) {
        killProcessGroup('SIGKILL')
        return finish(Object.assign(new Error(`Command timed out after ${timeout}ms`), { killed: true, code: 'ETIMEDOUT', stderr }))
      }
      if (code === 0) return finish()
      finish(Object.assign(new Error(`Command exited with code ${code ?? 1}`), { code, stderr }))
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function runHooks(
  hookType: HookType,
  profile: Profile,
  env: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<void> {
  const hooks = profile.hooks?.[hookType] ?? []
  const timeout_ms = profile.hooks?.timeout_ms ?? 5000
  for (const cmd of hooks) {
    if (signal?.aborted) return
    try {
      await runHookCommand(cmd, { ...(process.env as Record<string, string>), ...env }, timeout_ms, signal)
    } catch (e: any) {
      if (signal?.aborted || e.name === 'AbortError' || e.code === 'ABORT_ERR') {
        console.error(`[hook:${hookType}] cancelled: ${cmd}`)
        return
      }
      if (e.killed) {
        console.error(`[hook:${hookType}] timed out after ${timeout_ms}ms: ${cmd}`)
      } else {
        console.error(`[hook:${hookType}] failed: ${cmd}\n${e.stderr?.toString() ?? e.message}`)
      }
    }
  }
}
