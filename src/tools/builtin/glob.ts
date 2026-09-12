import fg from 'fast-glob'
import { ToolContext, ToolDefinition } from '../types.js'

export const globTool: ToolDefinition = {
  name: 'Glob',
  description: 'Find files matching a glob pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. src/**/*.ts)' },
      cwd: { type: 'string', description: 'Working directory (defaults to the session working directory)' },
    },
    required: ['pattern'],
  },
  async execute(input, context: ToolContext) {
    const { pattern, cwd = context.workingDir } = input as { pattern: string; cwd?: string }
    const files = await fg(pattern, { cwd, dot: true })
    return files.length > 0 ? files.join('\n') : '(no matches)'
  },
}
