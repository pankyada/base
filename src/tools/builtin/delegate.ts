import { ToolDefinition } from '../types.js'

export const delegateTool: ToolDefinition = {
  name: 'Delegate',
  description: 'Delegate a task to another profile (stub — not yet implemented).',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Target profile name' },
      task: { type: 'string', description: 'Task description for the sub-agent' },
    },
    required: ['profile', 'task'],
  },
  async execute(input) {
    const { profile, task } = input as { profile: string; task: string }
    return `[Delegate stub] Would run profile "${profile}" with task: "${task}". Inter-profile delegation not yet implemented.`
  },
}
