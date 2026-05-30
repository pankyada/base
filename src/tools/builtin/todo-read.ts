import type { ToolDefinition } from '../types.js'

export const todoReadTool: ToolDefinition = {
  name: 'TodoRead',
  description: 'Return the current todo list as JSON.',
  parameters: { type: 'object', properties: {} },
  async execute(_input, context) {
    return JSON.stringify(context.session.todos ?? [], null, 2)
  },
}
