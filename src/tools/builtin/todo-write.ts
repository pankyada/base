import type { ToolDefinition } from '../types.js'
import type { TodoItem } from '../../types.js'

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed'])
const VALID_PRIORITIES = new Set(['high', 'medium', 'low'])

export const todoWriteTool: ToolDefinition = {
  name: 'TodoWrite',
  description: 'Replace the current todo list with the provided items. Always pass the complete list — this overwrites everything.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Complete todo list',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['id', 'content', 'status', 'priority'],
        },
      },
    },
    required: ['items'],
  },
  async execute(input, context) {
    const { items } = input as { items: TodoItem[] }

    for (const item of items) {
      if (!VALID_STATUSES.has(item.status)) {
        return `Error: invalid status "${item.status}" — must be pending | in_progress | completed`
      }
      if (!VALID_PRIORITIES.has(item.priority)) {
        return `Error: invalid priority "${item.priority}" — must be high | medium | low`
      }
    }

    context.session.todos = items
    context.events.onTodosUpdate?.(items)
    return `Updated ${items.length} todo item${items.length !== 1 ? 's' : ''}`
  },
}
