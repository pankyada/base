import { execFile } from 'child_process'
import { ToolDefinition } from '../types.js'

const MAX_GREP_RUNTIME_MS = 30_000
const MAX_GREP_OUTPUT_BYTES = 10 * 1024 * 1024

// Recursing into dependency, VCS and build output turns a checkout-wide
// search into a multi-gigabyte scan that blows the runtime limit (a recon
// stage on this repository timed out on every Grep). Skip those directories
// and binary files unless the caller opts back in with its own flags.
const DEFAULT_EXCLUDED_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo', '.cache', '.playwright-mcp', 'bin']

export function grepArgs(pattern: string, path: string, flags: string | string[] = '-rn'): string[] {
  const flagArgs = (Array.isArray(flags) ? flags : flags.split(' ').filter(Boolean)).filter(flag => flag !== '--')
  const recursive = flagArgs.some(flag => flag === '-r' || flag === '-R' || flag === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(flag))
  const excludesOverridden = flagArgs.some(flag => flag.startsWith('--exclude-dir') || flag.startsWith('--include') || flag.startsWith('--exclude'))
  const binaryOverridden = flagArgs.some(flag => flag === '-a' || flag === '-I' || flag.startsWith('--binary-files') || flag === '--text' || /^-[a-zA-Z]*[aI][a-zA-Z]*$/.test(flag))
  const defaults = [
    ...(recursive && !excludesOverridden ? DEFAULT_EXCLUDED_DIRS.map(dir => `--exclude-dir=${dir}`) : []),
    ...(binaryOverridden ? [] : ['-I']),
  ]
  return [...defaults, ...flagArgs, '--', pattern, path]
}

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
    const args = grepArgs(pattern, path, flags)
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
