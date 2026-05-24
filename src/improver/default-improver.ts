import OpenAI from 'openai'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Session } from '../session/types.js'
import { MemoryProvider } from '../memory/interface.js'
import { Improver, ProposedSkill } from './interface.js'
import { queryEvents } from '../telemetry/query.js'
import { Profile } from '../profiles/schema.js'

export class DefaultImprover implements Improver {
  constructor(
    private readonly profile: Profile,
    private readonly openai: OpenAI
  ) {}

  private get modelId(): string {
    return this.profile.improvement?.model_id ?? this.profile.model.id
  }

  async reflect(session: Session, memory: MemoryProvider): Promise<void> {
    if (!this.profile.improvement?.enabled) return

    const transcript = (session.messages as any[])
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500)}`)
      .join('\n')
      .slice(0, 8_000)

    const memSection = await memory.buildSystemPromptSection()

    let memories: Array<{ key: string; content: string }> = []
    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelId,
        messages: [{
          role: 'user',
          content: `Review this agent session. Identify 0-3 things worth remembering for future sessions. Output ONLY a JSON array: [{"key":"slug","content":"markdown"}]. Empty array if nothing significant.\n\nCurrent memory:${memSection}\n\nTranscript:\n${transcript}`,
        }],
      })
      const raw = response.choices[0].message.content ?? '[]'
      // strip markdown code fences if present
      const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      memories = JSON.parse(cleaned)
      if (!Array.isArray(memories)) memories = []
    } catch {
      return
    }

    for (const m of memories) {
      if (m.key && m.content) await memory.write('profile', m.key, m.content)
    }

    if (memories.length > 0) {
      const learningsDir = join(this.profile.artifact_dir, 'learnings')
      mkdirSync(learningsDir, { recursive: true })
      const date = new Date().toISOString().slice(0, 10)
      const entry = `\n## Session ${session.id} (${new Date().toISOString()})\n` +
        memories.map(m => `- **${m.key}**: ${m.content.slice(0, 200)}`).join('\n') + '\n'
      writeFileSync(join(learningsDir, `${date}.md`), entry, { flag: 'a' })
    }
  }

  async mineSkills(sessions: Session[]): Promise<ProposedSkill[]> {
    if (!this.profile.improvement?.enabled || sessions.length === 0) return []

    const telemetry = queryEvents({ profile: this.profile.name })
    const toolFreq = telemetry
      .filter(e => e.kind === 'tool' || e.kind === 'mcp')
      .reduce((acc, e) => {
        const k = e.name ?? 'unknown'
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {} as Record<string, number>)

    const topTools = Object.entries(toolFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    let skills: ProposedSkill[] = []
    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelId,
        messages: [{
          role: 'user',
          content: `Based on ${sessions.length} sessions and these tool frequencies, propose 1-2 skills that could automate common workflows. Tool frequencies: ${JSON.stringify(topTools)}. Output ONLY a JSON array: [{"name":"skill-slug","description":"one line","content":"full markdown with ---\\nname: slug\\ndescription: one line\\n--- frontmatter"}]. Empty array if nothing compelling.`,
        }],
      })
      const raw = response.choices[0].message.content ?? '[]'
      const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      skills = JSON.parse(cleaned)
      if (!Array.isArray(skills)) skills = []
    } catch {
      return []
    }

    const proposedDir = join(
      join(this.profile.artifact_dir, 'skills'),
      '_proposed'
    )
    mkdirSync(proposedDir, { recursive: true })
    for (const skill of skills) {
      if (skill.name && skill.content) {
        const skillDir = join(proposedDir, skill.name)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), skill.content, 'utf-8')
      }
    }

    return skills
  }
}
