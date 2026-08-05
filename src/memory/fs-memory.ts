import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { MemoryProvider, MemoryEntry, MemoryLink, MemoryRecord, MemoryScope, RecallQuery, TemporalMeta } from './interface.js'
import { Session } from '../session/types.js'
import { userPaths, projectPaths } from '../session/user-paths.js'
import { imminentEntries, queryEntries, validateTemporal } from './query.js'

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
        return { content: parsed.content, links: parsed.links, temporal: parsed.temporal }
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
      temporal: temporalFrom(parsed.data),
    }
  }

  async write(scope: MemoryScope, key: string, content: string, links?: MemoryLink[], temporal?: TemporalMeta): Promise<void> {
    validateTemporal(temporal)
    if (scope === 'session') {
      this.session.session_memory[key] = JSON.stringify({ content, links, temporal })
      return
    }
    const dir = this.dirFor(scope)
    mkdirSync(dir, { recursive: true })
    const data = { ...(links?.length ? { links } : {}), ...(temporal ?? {}) }
    const fileContent = Object.keys(data).length > 0 ? matter.stringify(content, data) : content
    writeFileSync(join(dir, `${key}.md`), fileContent, 'utf-8')
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

  async list(scope: MemoryScope): Promise<MemoryEntry[]> {
    if (scope === 'session') {
      return Object.entries(this.session.session_memory).map(([key, val]) => {
        let preview = val.slice(0, 100)
        let links: MemoryLink[] | undefined
        try {
          const parsed = JSON.parse(val)
          preview = (parsed.content as string).slice(0, 100)
          links = parsed.links
          return { key, preview, content: parsed.content, links, temporal: parsed.temporal }
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
          temporal: temporalFrom(parsed.data),
        }
      })
  }

  async query(scope: MemoryScope, query: RecallQuery): Promise<MemoryEntry[]> {
    return queryEntries(await this.list(scope), query)
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
      ...imminentEntries(await this.list('profile'), now),
      ...imminentEntries(await this.list('user'), now),
      ...((this.session.project ?? 'inbox') === 'inbox' ? [] : imminentEntries(await this.list('project'), now)),
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

function temporalFrom(data: Record<string, unknown>): TemporalMeta | undefined {
  const temporal: TemporalMeta = {}
  for (const key of ['valid_from', 'valid_until', 'recur', 'timezone', 'entity', 'supersedes'] as const) {
    if (typeof data[key] === 'string') temporal[key] = data[key] as never
  }
  if (typeof data.confidence === 'number') temporal.confidence = data.confidence
  return Object.keys(temporal).length ? temporal : undefined
}
