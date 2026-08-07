import OpenAI from 'openai'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Session } from '../session/types.js'
import { MemoryProvider, TemporalMeta } from '../memory/interface.js'
import { Improver, ProposedSkill } from './interface.js'
import { queryEvents } from '../telemetry/query.js'
import { Profile } from '../profiles/schema.js'
import { saveSession } from '../session/store.js'
import { aggregateRouting } from '../analysis/routing.js'
import { parseRoutingPolicy, updateRoutingPolicy } from '../workflow/adaptive.js'

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

    let memories: Array<{ key: string; content: string; temporal?: TemporalMeta }> = []
    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelId,
        messages: [{
          role: 'user',
          content: `Review this agent session. Identify 0-3 things worth remembering for future sessions. Output ONLY JSON: {"summary":"one short line describing the session","memories":[{"key":"slug","content":"markdown","temporal":{"valid_from":"ISO-8601 with offset","valid_until":"ISO-8601 with offset","recur":"optional supported recurrence","timezone":"optional IANA timezone","entity":"optional entity","confidence":0.0,"supersedes":"optional memory key"}}]} (memories may be empty). Add temporal metadata only when the session gives a clear explicit signal; never invent dates or recurrence.\n\nCurrent memory:${memSection}\n\nTranscript:\n${transcript}`,
        }],
      })
      const raw = response.choices[0].message.content ?? '{}'
      // strip markdown code fences if present
      const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      const parsed = JSON.parse(cleaned) as { summary?: string; memories?: Array<{ key: string; content: string; temporal?: TemporalMeta }> }
      memories = Array.isArray(parsed.memories)
        ? parsed.memories.filter(m => typeof m?.key === 'string' && typeof m?.content === 'string')
        : []
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        session.summary = parsed.summary.trim()
        saveSession(session)
      }
    } catch {
      return
    }

    for (const m of memories) {
      if (m.key && m.content) await memory.write('user', m.key, m.content, undefined, m.temporal)
    }

    if (memories.length > 0) {
      const learningsDir = join(this.profile.artifact_dir, 'learnings')
      mkdirSync(learningsDir, { recursive: true })
      const date = new Date().toISOString().slice(0, 10)
      const entry = `\n## Session ${session.id} (${new Date().toISOString()})\n` +
        memories.map(m => `- **${m.key}**: ${m.content.slice(0, 200)}`).join('\n') + '\n'
      writeFileSync(join(learningsDir, `${date}.md`), entry, { flag: 'a' })
    }

    if (this.profile.workflow?.enabled && this.profile.workflow.routing.policy === 'adaptive') {
      try {
        const currentRaw = await memory.read('project', 'routing-policy')
        const current = parseRoutingPolicy(currentRaw?.content) ?? {}
        const report = aggregateRouting(queryEvents({ profile: this.profile.name }))
        const cells = Object.fromEntries(Object.values(report.cells).map(cell => [`${cell.task_class}|${cell.stage}`, { tier: cell.tier as 'cheap' | 'balanced' | 'frontier' | 'critic', n: cell.n, first_try: cell.first_try_rate ?? 0, rework_rate: cell.rework_rate ?? 0, consecutive_escalations: cell.consecutive_escalations, reversibility: cell.reversibility }]))
        const floor = this.profile.workflow.routing.table as Partial<Record<'recon' | 'plan' | 'design' | 'build' | 'verify' | 'review', 'cheap' | 'balanced' | 'frontier' | 'critic'>>
        const updated = updateRoutingPolicy({ cells }, current, floor, this.profile.workflow.playbook)
        await memory.write('project', 'routing-policy', JSON.stringify(updated, null, 2))
      } catch {
        // Adaptive policy is advisory and must never break reflection.
      }
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
