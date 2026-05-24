import { readFileSync, writeFileSync } from 'fs'
import { ToolDefinition } from '../types.js'

export const editTool: ToolDefinition = {
  name: 'Edit',
  description: 'Replace an exact string in a file. old_string must be unique unless replace_all is true.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string', description: 'Exact text to find (must be unique in file)' },
      new_string: { type: 'string', description: 'Text to replace it with' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(input) {
    const { file_path, old_string, new_string, replace_all = false } = input as {
      file_path: string; old_string: string; new_string: string; replace_all?: boolean
    }
    const content = readFileSync(file_path, 'utf-8')
    const count = content.split(old_string).length - 1
    if (count === 0) throw new Error(`old_string not found in ${file_path}`)
    if (!replace_all && count > 1) throw new Error(`old_string found ${count} times — must be unique or use replace_all: true`)
    const updated = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string)
    writeFileSync(file_path, updated, 'utf-8')
    return `Replaced ${count} occurrence(s) in ${file_path}`
  },
}
