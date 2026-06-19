import { spawn } from 'child_process'
import { ToolDefinition } from '../types.js'
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
  async execute(input) {
    const { command, timeout = 120_000 } = input as { command: string; timeout?: number }
    const effectiveTimeout = Math.min(timeout, 120_000)
    return new Promise((resolve, reject) => {
      let output = ''
      const proc = spawn('bash', ['-c', command], {
        env: sanitizeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const timer = setTimeout(() => {
        proc.kill()
        resolve(`[timeout after ${effectiveTimeout}ms]\n${output}`)
      }, effectiveTimeout)
      proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { output += d.toString() })
      proc.on('close', (code) => {
        clearTimeout(timer)
        const truncated = output.length > MAX_OUTPUT
          ? output.slice(0, MAX_OUTPUT) + '\n[truncated]'
          : output
        resolve(code === 0 ? truncated : `Exit ${code}\n${truncated}`)
      })
      proc.on('error', reject)
    })
  },
}
