import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { MemoryProvider, MemoryEntry, MemoryLink, MemoryRecord, MemoryScope, RecallQuery, TemporalMeta, ClaimMeta, RetentionMeta } from './interface.js'
import { Session } from '../session/types.js'
import { userPaths, projectPaths } from '../session/user-paths.js'
import { imminentEntries, queryEntries } from './query.js'
import { parseTemporal, serializeTemporal, validateTemporal } from './temporal.js'

export class FsMemoryProvider implements MemoryProvider {
  constructor(
    private readonly artifactDir: string,
    private readonly session: Session
  ) {}

  private get sharedMemDir(): string {
    return join(this.artifactDir, 'memory')
  }

  private get privateMemDir(): string {
    return userPaths(this.session.user, this.artifactDir).privateMemDir
  }

  private get projectMemDir(): string {
    return projectPaths(this.session.user, this.session.project ?? 'inbox').memoryDir
  }

  private dirFor(scope: 'profile' | 'user' | 'project'): string {
    if (scope === 'profile') return this.sharedMemDir
    if (scope === 'project') return this.projectMemDir
    return this.privateMemDir
  }

  async read(scope: MemoryScope, key: string): Promise<MemoryRecord | null> {
    if (scope === 'session') {
      const val = this.session.session_memory[key]
      if (!val) return null
      try {
        const parsed = JSON.parse(val)
        return { content: parsed.content, links: parsed.links, temporal: parsed.temporal, provenance: parsed.provenance, source: parsed.source, claim: parsed.claim, retention: parsed.retention, source_evidence: parsed.source_evidence, source_revision: parsed.source_revision }
      } catch {
        return { content: val }
      }
    }
    const path = join(this.dirFor(scope), `${key}.md`)
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = matter(raw)
    return {
      content: parsed.content.trim(),
      links: parsed.data.links as MemoryLink[] | undefined,
      temporal: parseTemporal(parsed.data), provenance: parsed.data.tainted ? 'untrusted' : 'trusted', source: typeof parsed.data.taint_source === 'string' ? parsed.data.taint_source : undefined, claim: parsed.data.claim as ClaimMeta | undefined,
      retention: parsed.data.retention as RetentionMeta | undefined, source_evidence: parsed.data.source_evidence as string[] | undefined, source_revision: typeof parsed.data.source_revision === 'string' ? parsed.data.source_revision : undefined,
    }
  }

  async write(scope: MemoryScope, key: string, content: string, links?: MemoryLink[], temporal?: TemporalMeta, provenance?: { tainted: boolean; source?: string }, claim?: ClaimMeta): Promise<void> {
    validateTemporal(temporal)
    if (scope === 'session') {
      const existing = await this.read(scope, key)
      this.session.session_memory[key] = JSON.stringify({ content, links, temporal, provenance: provenance?.tainted ? 'untrusted' : 'trusted', source: provenance?.source, claim, retention: existing?.retention, source_evidence: existing?.source_evidence, source_revision: existing?.source_revision })
      return
    }
    const dir = this.dirFor(scope)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${key}.md`)
    const previous = existsSync(path) ? matter(readFileSync(path, 'utf-8')).data : {}
    const preserved = Object.fromEntries(['retention', 'source_evidence', 'source_revision'].filter(key => previous[key] !== undefined).map(key => [key, previous[key]]))
    const data = { ...preserved, ...(links?.length ? { links } : {}), ...serializeTemporal(temporal), ...(provenance?.tainted ? { tainted: true, taint_source: provenance.source } : {}), ...(claim ? { claim } : {}) }
    const fileContent = Object.keys(data).length > 0 ? matter.stringify(content, data) : content
    writeFileSync(path, fileContent, 'utf-8')
    await this.rebuildIndex(scope)
  }

  async writeRecord(scope: MemoryScope, key: string, record: MemoryRecord): Promise<void> {
    validateTemporal(record.temporal)
    if (scope === 'session') {
      this.session.session_memory[key] = JSON.stringify({ content: record.content, links: record.links, temporal: record.temporal, provenance: record.provenance ?? 'trusted', source: record.source, claim: record.claim, retention: record.retention, source_evidence: record.source_evidence, source_revision: record.source_revision })
      return
    }
    const dir = this.dirFor(scope)
    mkdirSync(dir, { recursive: true })
    const path = join(this.dirFor(scope), `${key}.md`)
    const data = { ...(record.links?.length ? { links: record.links } : {}), ...serializeTemporal(record.temporal), ...(record.provenance === 'untrusted' ? { tainted: true, taint_source: record.source } : {}), ...(record.claim ? { claim: record.claim } : {}), ...(record.retention ? { retention: record.retention } : {}), ...(record.source_evidence ? { source_evidence: record.source_evidence } : {}), ...(record.source_revision ? { source_revision: record.source_revision } : {}) }
    writeFileSync(path, Object.keys(data).length > 0 ? matter.stringify(record.content, data) : record.content, 'utf-8')
    await this.rebuildIndex(scope)
  }

  async delete(scope: MemoryScope, key: string): Promise<void> {
    if (scope === 'session') {
      delete this.session.session_memory[key]
      return
    }
    const path = join(this.dirFor(scope), `${key}.md`)
    if (existsSync(path)) {
      unlinkSync(path)
      await this.rebuildIndex(scope)
    }
  }

  async archive(scope: MemoryScope, key: string, metadata: Omit<RetentionMeta, 'state'> & { state?: 'archived' | 'review' } = {}): Promise<void> {
    const current = await this.read(scope, key)
    if (!current) throw new Error(`memory entry not found: ${scope}/${key}`)
    const retention: RetentionMeta = { ...current.retention, ...metadata, state: metadata.state ?? 'archived', decided_at: metadata.decided_at ?? new Date().toISOString() }
    if (scope === 'session') {
      this.session.session_memory[key] = JSON.stringify({ ...current, provenance: current.provenance, retention })
      return
    }
    const path = join(this.dirFor(scope), `${key}.md`)
    const parsed = matter(readFileSync(path, 'utf-8'))
    writeFileSync(path, matter.stringify(parsed.content, { ...parsed.data, retention }), 'utf-8')
    await this.rebuildIndex(scope)
  }

  async restore(scope: MemoryScope, key: string): Promise<void> {
    const current = await this.read(scope, key)
    if (!current) throw new Error(`memory entry not found: ${scope}/${key}`)
    const retention = current.retention ? { ...current.retention, state: 'active' as const, decided_at: new Date().toISOString() } : undefined
    if (scope === 'session') {
      this.session.session_memory[key] = JSON.stringify({ ...current, retention })
      return
    }
    const path = join(this.dirFor(scope), `${key}.md`)
    const parsed = matter(readFileSync(path, 'utf-8'))
    const data = { ...parsed.data }
    if (retention) data.retention = retention
    else delete data.retention
    writeFileSync(path, matter.stringify(parsed.content, data), 'utf-8')
    await this.rebuildIndex(scope)
  }

  async list(scope: MemoryScope): Promise<MemoryEntry[]> {
    if (scope === 'session') {
      return Object.entries(this.session.session_memory).map(([key, val]) => {
        let preview = val.slice(0, 100)
        let links: MemoryLink[] | undefined
        try {
          const parsed = JSON.parse(val)
          preview = (parsed.content as string).slice(0, 100)
          links = parsed.links
          return { key, preview, content: parsed.content, links, temporal: parsed.temporal, claim: parsed.claim, provenance: parsed.provenance, source: parsed.source, retention: parsed.retention, source_evidence: parsed.source_evidence, source_revision: parsed.source_revision }
        } catch { /* ignore */ }
        return { key, preview, content: preview, links }
      })
    }
    const dir = this.dirFor(scope)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .map(f => {
        const key = f.replace(/\.md$/, '')
        const raw = readFileSync(join(dir, f), 'utf-8')
        const parsed = matter(raw)
        return {
          key,
          preview: parsed.content.trim().slice(0, 100),
          content: parsed.content.trim(),
          links: parsed.data.links as MemoryLink[] | undefined,
          temporal: parseTemporal(parsed.data), claim: parsed.data.claim as ClaimMeta | undefined,
          provenance: parsed.data.tainted ? 'untrusted' : 'trusted', source: typeof parsed.data.taint_source === 'string' ? parsed.data.taint_source : undefined, retention: parsed.data.retention as RetentionMeta | undefined, source_evidence: parsed.data.source_evidence as string[] | undefined, source_revision: typeof parsed.data.source_revision === 'string' ? parsed.data.source_revision : undefined,
        }
      })
  }

  async query(scope: MemoryScope, query: RecallQuery): Promise<MemoryEntry[]> {
    return queryEntries((await this.list(scope)).filter(entry => entry.retention?.state !== 'archived'), query)
  }

  async buildSystemPromptSection(): Promise<string> {
    const parts: string[] = []

    const render = (entries: MemoryEntry[]) => entries.map(entry => `- **${entry.key}**: ${entry.preview.replace(/\n/g, ' ')}`).join('\n')
    const now = new Date()
    const at = now.toISOString()
    const shared = await this.query('profile', { at })
    const personal = await this.query('user', { at })
    const project = (this.session.project ?? 'inbox') === 'inbox' ? [] : await this.query('project', { at })
    const imminent = [
      ...imminentEntries((await this.list('profile')).filter(entry => entry.retention?.state !== 'archived'), now),
      ...imminentEntries((await this.list('user')).filter(entry => entry.retention?.state !== 'archived'), now),
      ...((this.session.project ?? 'inbox') === 'inbox' ? [] : imminentEntries((await this.list('project')).filter(entry => entry.retention?.state !== 'archived'), now)),
    ]
    if (shared.length) parts.push(`## Memory (shared)\n${render(shared)}`)
    if (personal.length) parts.push(`## Memory (yours)\n${render(personal)}`)
    if (project.length) parts.push(`## Memory (project)\n${render(project)}`)
    if (imminent.length) parts.push(`## Memory (imminent)\n${render(imminent)}`)

    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''
  }

  private async rebuildIndex(scope: 'profile' | 'user' | 'project'): Promise<void> {
    const entries = await this.list(scope)
    const lines = entries.map(e => {
      const linksStr = e.links && e.links.length > 0
        ? ` [links: ${e.links.map(l => `${l.relation ? l.relation + ':' : ''}${l.target}`).join(', ')}]`
        : ''
      return `- **${e.key}**: ${e.preview.replace(/\n/g, ' ')}${linksStr}`
    })
    const dir = this.dirFor(scope)
    writeFileSync(join(dir, 'MEMORY.md'), `# Memory Index\n\n${lines.join('\n')}\n`, 'utf-8')
  }
}
