import type { ToolDefinition } from '../types.js'

export const notifyTool: ToolDefinition = {
  name: 'Notify',
  description: 'Send a message through a configured channel to the current user.',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Configured channel name. Omit to use the default.' },
      text: { type: 'string' },
      urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
      buttons: { type: 'array', items: { type: 'string' } },
    },
    required: ['text'],
  },
  async execute(input, context) {
    if (!context.channels) return '[notify not supported in this environment]'
    const text = typeof input.text === 'string' ? input.text : ''
    const buttons = Array.isArray(input.buttons)
      ? input.buttons.filter((value): value is string => typeof value === 'string').map((label, index) => ({ id: String(index + 1), label }))
      : undefined
    const result = await context.channels.send(context.session.user, typeof input.channel === 'string' ? input.channel : undefined, {
      text,
      urgency: input.urgency as 'low' | 'normal' | 'high' | undefined,
      buttons,
    })
    return result.ok ? '[notification sent]' : result.error ?? '[notification failed]'
  },
}

