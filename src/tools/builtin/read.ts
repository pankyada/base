import { readFileSync } from 'fs'
import { ToolDefinition } from '../types.js'

export const readTool: ToolDefinition = {
  name: 'Read',
  description: 'Read a file. Returns content with line numbers (cat -n format).',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to file' },
      offset: { type: 'number', description: 'Start line, 1-indexed (default 1)' },
      limit: { type: 'number', description: 'Max lines to read (default 2000)' },
    },
    required: ['file_path'],
  },
  async execute(input) {
    const { file_path, offset = 1, limit = 2000 } = input as {
      file_path: string; offset?: number; limit?: number
    }
    const content = readFileSync(file_path, 'utf-8')
    const lines = content.split('\n')
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    return slice.map((l, i) => `${offset + i}\t${l}`).join('\n')
  },
}
