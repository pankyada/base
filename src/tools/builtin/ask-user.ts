import { randomUUID } from 'crypto'
import type { ToolDefinition } from '../types.js'
import type { InputRequestKind } from '../../types.js'

export const askUserTool: ToolDefinition = {
  name: 'AskUser',
  description: 'Pause and ask the user a question. Use kind="text" for free text, "select" for one choice from options, "multi_select" for multiple choices from options.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Question to ask the user' },
      kind: {
        type: 'string',
        enum: ['text', 'select', 'multi_select'],
        description: 'Input type',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required for select and multi_select kinds',
      },
    },
    required: ['prompt', 'kind'],
  },
  async execute(input, context) {
    const { prompt, kind, options } = input as {
      prompt: string
      kind: InputRequestKind
      options?: string[]
    }

    if (!context.events.onInputRequest) {
      return '[input_request not supported in this environment]'
    }

    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    const response = await context.events.onInputRequest(id, prompt, kind, options)
    return response
  },
}
