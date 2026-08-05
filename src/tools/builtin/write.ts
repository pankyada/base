import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { ToolDefinition } from '../types.js'
import { recordHarnessWrite } from '../../triggers/suppression.js'

export const writeTool: ToolDefinition = {
  name: 'Write',
  description: 'Write content to a file, creating parent directories as needed.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['file_path', 'content'],
  },
  async execute(input) {
    const { file_path, content } = input as { file_path: string; content: string }
    mkdirSync(dirname(file_path), { recursive: true })
    writeFileSync(file_path, content, 'utf-8')
    recordHarnessWrite(file_path)
    return `Written ${content.length} bytes to ${file_path}`
  },
}
