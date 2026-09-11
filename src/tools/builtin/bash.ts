import { spawn } from 'child_process'
import type { ToolDefinition, ToolContext } from '../types.js'
import { sanitizeEnv } from './env-filter.js'

const MAX_OUTPUT = 50_000

export const bashTool: ToolDefinition = {
  name: 'Bash',
  description: 'Execute a bash command. Timeout 120s max. stdout + stderr combined.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number', description: 'Timeout in ms (max 120000, default 120000)' },
    },
    required: ['command'],
  },
  async execute(input, context: ToolContext) {
    const { command, timeout = 120_000 } = input as { command: string; timeout?: number }
    const effectiveTimeout = Math.min(timeout, 120_000)
    if (context.signal?.aborted) return '[cancelled]\n'
    return new Promise((resolve, reject) => {
      let output = ''
      let settled = false
      let timedOut = false
      let forceKillTimer: NodeJS.Timeout | undefined
      const proc = spawn('bash', ['-c', command], {
        env: sanitizeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      const cleanup = () => {
        clearTimeout(timer)
        if (forceKillTimer) clearTimeout(forceKillTimer)
        context.signal?.removeEventListener('abort', abort)
      }
      const finish = (value: string) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const killProcessGroup = (signal: NodeJS.Signals) => {
        if (process.platform !== 'win32' && proc.pid) {
          try { process.kill(-proc.pid, signal) } catch { /* process already exited */ }
        } else {
          proc.kill(signal)
        }
      }
      const abort = () => {
        if (settled) return
        killProcessGroup('SIGTERM')
        forceKillTimer = setTimeout(() => {
          killProcessGroup('SIGKILL')
          finish(`[cancelled]\n${output}`)
        }, 250)
      }
      const timer = setTimeout(() => {
        if (settled || timedOut) return
        timedOut = true
        killProcessGroup('SIGTERM')
        forceKillTimer = setTimeout(() => {
          killProcessGroup('SIGKILL')
          finish(`[timeout after ${effectiveTimeout}ms]\n${output}`)
        }, 250)
      }, effectiveTimeout)
      proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { output += d.toString() })
      proc.on('close', (code) => {
        if (settled) return
        if (context.signal?.aborted) {
          killProcessGroup('SIGKILL')
          return finish(`[cancelled]\n${output}`)
        }
        if (timedOut) {
          killProcessGroup('SIGKILL')
          return finish(`[timeout after ${effectiveTimeout}ms]\n${output}`)
        }
        const truncated = output.length > MAX_OUTPUT
          ? output.slice(0, MAX_OUTPUT) + '\n[truncated]'
          : output
        finish(code === 0 ? truncated : `Exit ${code}\n${truncated}`)
      })
      proc.on('error', error => { if (!settled) { settled = true; cleanup(); reject(error) } })
      if (context.signal?.aborted) abort()
      else context.signal?.addEventListener('abort', abort, { once: true })
    })
  },
}
