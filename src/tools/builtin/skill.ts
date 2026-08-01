import { readFileSync } from 'fs'
import { ToolDefinition, ToolContext } from '../types.js'
import { logEvent } from '../../telemetry/logger.js'
import { pin } from '../../context/pins.js'

export const skillTool: ToolDefinition = {
  name: 'Skill',
  description: 'Load and read a skill by name. Returns the full skill content.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name as listed in the skill index' },
    },
    required: ['name'],
  },
  async execute(input, ctx: ToolContext) {
    const { name } = input as { name: string }
    const skill = ctx.skills.find(s => s.name === name)
    if (!skill) {
      const available = ctx.skills.map(s => s.name).join(', ')
      return `Skill "${name}" not found. Available: ${available || '(none)'}`
    }
    logEvent({
      session: ctx.session.id,
      profile: ctx.profile.name,
      kind: 'skill',
      name,
      trigger: 'model',
    })
    const content = readFileSync(skill.filePath, 'utf-8')
    if (pin(ctx.session, ctx.profile, name, content) === 'over-budget') {
      ctx.events.onNotice?.('warn', 'skill pin budget exceeded', `Skill "${name}" remains available as a normal tool result`)
    }
    return content
  },
}
