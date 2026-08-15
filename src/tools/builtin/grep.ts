import { execFile } from 'child_process'
import { ToolDefinition } from '../types.js'

const MAX_GREP_RUNTIME_MS = 30_000
const MAX_GREP_OUTPUT_BYTES = 10 * 1024 * 1024

export const grepTool: ToolDefinition = {
  name: 'Grep',
  description: 'Search for a regex pattern in files.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern' },
      path: { type: 'string', description: 'File or directory to search' },
      flags: {
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        description: 'grep flags; prefer an array for flags with values (default: -rn)',
      },
    },
    required: ['pattern', 'path'],
  },
  async execute(input, context) {
    const { pattern, path, flags = '-rn' } = input as { pattern: string; path: string; flags?: string | string[] }
    const flagArgs = (Array.isArray(flags) ? flags : flags.split(' ').filter(Boolean)).filter(flag => flag !== '--')
    const args = [...flagArgs, '--', pattern, path]
    return new Promise<string>((resolve, reject) => {
      const proc = execFile('grep', args, {
        encoding: 'utf-8', maxBuffer: MAX_GREP_OUTPUT_BYTES, timeout: MAX_GREP_RUNTIME_MS,
      }, (error, stdout, stderr) => {
        context.signal?.removeEventListener('abort', abort)
        if (!error) return resolve(stdout)
        if ((error as any).code === 1) return resolve('(no matches)')
        if ((error as any).killed) return reject(new Error(`Grep timed out after ${MAX_GREP_RUNTIME_MS}ms`))
        reject(new Error(stderr.trim() || error.message))
      })
      const abort = () => {
        proc.kill()
        reject(new Error('Grep cancelled'))
      }
      if (context.signal?.aborted) return abort()
      context.signal?.addEventListener('abort', abort, { once: true })
    })
  },
}
