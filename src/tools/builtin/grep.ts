import { execFileSync } from 'child_process'
import { ToolDefinition } from '../types.js'

export const grepTool: ToolDefinition = {
  name: 'Grep',
  description: 'Search for a regex pattern in files.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern' },
      path: { type: 'string', description: 'File or directory to search' },
      flags: { type: 'string', description: 'grep flags (default: -rn)' },
    },
    required: ['pattern', 'path'],
  },
  async execute(input) {
    const { pattern, path, flags = '-rn' } = input as { pattern: string; path: string; flags?: string }
    try {
      const args = [...flags.split(' ').filter(Boolean), pattern, path]
      return execFileSync('grep', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    } catch (e: any) {
      if (e.status === 1) return '(no matches)'
      throw new Error(e.stderr ?? e.message)
    }
  },
}
