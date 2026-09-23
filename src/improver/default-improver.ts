import OpenAI from 'openai'
import matter from 'gray-matter'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Session } from '../session/types.js'
import { MemoryProvider, TemporalMeta } from '../memory/interface.js'
import { Improver, ProposedPlaybook, ProposedSkill } from './interface.js'
import { queryEvents } from '../telemetry/query.js'
import { Profile } from '../profiles/schema.js'
import { saveSession } from '../session/store.js'
import { aggregateRouting } from '../analysis/routing.js'
import { parseRoutingPolicy, updateRoutingPolicy } from '../workflow/adaptive.js'
import { STAGES } from '../workflow/types.js'
import type { ProviderClient } from '../provider/types.js'
import { isProviderControlFailure } from '../provider/errors.js'
import type { MemoryCaptureService } from '../decisions/memory.js'
import { clearRoutingMisses, readRoutingMisses } from '../workflow/routing-misses.js'


const PLAYBOOK_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export class DefaultImprover implements Improver {
  constructor(
    private readonly profile: Profile,
    private readonly openai?: OpenAI,
    private readonly provider?: ProviderClient,
    private readonly capture?: MemoryCaptureService,
  ) {}

  private get modelId(): string {
    return this.profile.improvement?.model_id ?? this.profile.model.id
  }

  private async complete(content: string, purpose: string): Promise<string> {
    if (this.provider) {
      return (await this.provider.generate({ model: this.modelId, stream: false, messages: [{ role: 'user', content }] }, { purpose })).text
    }
    if (!this.openai) throw new Error('improvement provider unavailable')
    const response = await this.openai.chat.completions.create({ model: this.modelId, messages: [{ role: 'user', content }] })
    return response.choices[0]?.message?.content ?? ''
  }

  async reflect(session: Session, memory: MemoryProvider): Promise<void> {
    if (!this.profile.improvement?.enabled) return

    const transcript = (session.messages as any[])
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : JSON.stringify(m.content, (key, value) => key === 'providerState' ? undefined : value).slice(0, 500)}`)
      .join('\n')
      .slice(0, 8_000)

    const memSection = await memory.buildSystemPromptSection()

    let memories: Array<{ key: string; content: string; temporal?: TemporalMeta }> = []
    try {
      const raw = await this.complete(`Review this agent session. Identify 0-3 things worth remembering for future sessions. Output ONLY JSON: {"summary":"one short line describing the session","memories":[{"key":"slug","content":"markdown","temporal":{"valid_from":"ISO-8601 with offset","valid_until":"ISO-8601 with offset","recur":"optional supported recurrence","timezone":"optional IANA timezone","entity":"optional entity","confidence":0.0,"supersedes":"optional memory key"}}]} (memories may be empty). Add temporal metadata only when the session gives a clear explicit signal; never invent dates or recurrence.\n\nCurrent memory:${memSection}\n\nTranscript:\n${transcript}`, 'improvement-reflection')
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
    } catch (error) {
      if (isProviderControlFailure(error)) throw error
      return
    }

    for (const m of memories) {
      if (m.key && m.content) {
        if (this.capture) {
          const evidenceSpans = (session.messages as any[]).map((message, messageIndex) => ({
            id: `session:${session.id}:message:${messageIndex}`,
            text: `${message.role ?? 'message'}: ${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`.slice(0, 2_000),
            provenance: message.provenance as 'trusted' | 'untrusted' | undefined,
            source: typeof message.source === 'string' ? message.source : undefined,
          }))
          await this.capture.captureAutomatic(memory, {
            scope: 'user',
            key: m.key,
            content: m.content,
            temporal: m.temporal,
            evidence: { ids: evidenceSpans.map(span => span.id), spans: evidenceSpans, revision: `${session.id}:${session.revision}` },
          })
        } else {
          await memory.write('user', m.key, m.content, undefined, m.temporal)
        }
      }
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
      const raw = await this.complete(`Based on ${sessions.length} sessions and these tool frequencies, propose 1-2 skills that could automate common workflows. Tool frequencies: ${JSON.stringify(topTools)}. Output ONLY a JSON array: [{"name":"skill-slug","description":"one line","content":"full markdown with ---\\nname: slug\\ndescription: one line\\n--- frontmatter"}]. Empty array if nothing compelling.`, 'improvement-skill-mining')
      const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      skills = JSON.parse(cleaned)
      if (!Array.isArray(skills)) skills = []
    } catch (error) {
      if (isProviderControlFailure(error)) throw error
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

  /**
   * Roadmap #31 phase 6 (PT-081), spec §6 item 4. Reads the opt-in local
   * `routing-misses` project-memory store, and when at least
   * `workflow.router.mining.min_cluster` misses have accumulated, asks the
   * improver's model to group them and propose at most one new playbook —
   * written as a draft `PLAYBOOK.md` under `<artifact_dir>/playbooks/_proposed/`,
   * never into a discovered playbook root, and never auto-installed. Misses
   * are cleared only after a successful, validated proposal is written.
   * Returns `null` whenever there is nothing to propose (mining disabled,
   * not enough data, no coherent cluster, or a malformed model response) —
   * this is advisory and must never throw except on a provider control
   * failure (mirrors `mineSkills`'s error handling).
   */
  async minePlaybooks(): Promise<ProposedPlaybook | null> {
    if (!this.profile.improvement?.enabled) return null
    const mining = this.profile.workflow?.router?.mining
    if (!mining?.enabled) return null

    const misses = readRoutingMisses(this.profile)
    if (misses.length < mining.min_cluster) return null

    let raw: string
    try {
      const excerptList = misses.map((miss, index) => `${index + 1}. ${miss.excerpt}`).join('\n')
      raw = await this.complete(
        `These are ${misses.length} user requests that could not be confidently routed to any existing workflow playbook (excerpts, possibly truncated):\n${excerptList}\n\n` +
        'If they share a common theme that would justify a new dedicated playbook, output ONLY a single Markdown file in this exact format (gray-matter frontmatter, then stage sections, same shape as the existing playbooks under .agents/playbooks/*/PLAYBOOK.md):\n\n' +
        '---\nname: slug-name\ndescription: one line description\nstages: [recon, plan, build, verify]\ntask_classes: [general]\ndefaults:\n  general: { recon: 1, plan: 1, design: 0, build: 2, verify: 1, review: 0 }\n---\n\n' +
        '## recon\n### L1\nRequired artifact sections: `Files touched`, `Prior knowledge`, `Open questions`.\nExit criteria: current state inspected before planning.\n\n' +
        '## plan\n### L1\nRequired artifact sections: `Plan`, `Risks`.\nExit criteria: a sequence and risks are explicit.\n\n' +
        '## build\n### L1\nRequired artifact sections: `Result`.\nExit criteria: the requested artifact is produced.\n\n' +
        '## verify\n### L1\nRequired artifact sections: `Verification`.\nExit criteria: artifact is checked against reality.\n\n' +
        'Output NOTHING else — no prose, no code fences. If there is no coherent common theme, output exactly: NONE',
        'improvement-playbook-mining',
      )
    } catch (error) {
      if (isProviderControlFailure(error)) throw error
      return null
    }

    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
    if (!cleaned || cleaned.toUpperCase() === 'NONE') return null

    let name: string
    try {
      const { data, content } = matter(cleaned)
      if (typeof data.name !== 'string' || !data.name.trim()) return null
      if (typeof data.description !== 'string' || !data.description.trim()) return null
      if (!Array.isArray(data.stages) || data.stages.length === 0 || !data.stages.every((s: unknown) => typeof s === 'string' && (STAGES as readonly string[]).includes(s as string))) return null
      if (!content.trim()) return null
      name = data.name.trim()
      if (!PLAYBOOK_NAME.test(name)) return null
    } catch {
      return null
    }

    const proposedDir = join(this.profile.artifact_dir, 'playbooks', '_proposed', name)
    mkdirSync(proposedDir, { recursive: true })
    const path = join(proposedDir, 'PLAYBOOK.md')
    writeFileSync(path, cleaned, 'utf-8')

    try {
      clearRoutingMisses(this.profile)
    } catch {
      // Best-effort: the proposal already landed; a failed clear just means
      // the next mining pass sees the same misses again (idempotent, not harmful).
    }

    return { name, path }
  }
}
