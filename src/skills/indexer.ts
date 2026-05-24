import { Skill } from '../tools/types.js'

export function buildSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return ''
  const lines = skills.map(s => `- **${s.name}**: ${s.description}`)
  return `\n\n## Available Skills\nInvoke with Skill({name}) tool.\n${lines.join('\n')}`
}
