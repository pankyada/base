import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { MemoryProvider, MemoryEntry, MemoryLink, MemoryRecord, MemoryScope, RecallQuery, TemporalMeta } from './interface.js'
import { Session } from '../session/types.js'
import { userPaths, projectPaths } from '../session/user-paths.js'
import { imminentEntries, queryEntries } from './query.js'
import { validateTemporal } from './temporal.js'

interface GraphNode {
  key: string
  content: string
  links?: MemoryLink[]
  temporal?: TemporalMeta
  provenance?: 'trusted' | 'untrusted'
  source?: string
}

interface GraphData {
  nodes: Record<string, GraphNode>
}

export class GraphMemoryProvider implements MemoryProvider {
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

  private dirForScope(scope: 'profile' | 'user' | 'project'): string {
    if (scope === 'profile') return this.sharedMemDir
    if (scope === 'project') return this.projectMemDir
    return this.privateMemDir
  }

  private getGraphPath(scope: 'profile' | 'user' | 'project'): string {
    const dir = this.dirForScope(scope)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'graph.json')
  }

  private loadGraph(scope: 'profile' | 'user' | 'project'): GraphData {
    const path = this.getGraphPath(scope)
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf-8'))
      } catch {
        return { nodes: {} }
      }
    }
    return { nodes: {} }
  }

  private saveGraph(scope: 'profile' | 'user' | 'project', data: GraphData): void {
    const path = this.getGraphPath(scope)
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  }

  async read(scope: MemoryScope, key: string): Promise<MemoryRecord | null> {
    if (scope === 'session') {
      const val = this.session.session_memory[key]
      if (!val) return null
      try {
        const parsed = JSON.parse(val)
        return { content: parsed.content, links: parsed.links, temporal: parsed.temporal, provenance: parsed.provenance, source: parsed.source }
      } catch {
        return { content: val }
      }
    }
    const graph = this.loadGraph(scope)
    const node = graph.nodes[key]
    if (!node) return null
    return { content: node.content, links: node.links, temporal: node.temporal, provenance: node.provenance, source: node.source }
  }

  async write(scope: MemoryScope, key: string, content: string, links?: MemoryLink[], temporal?: TemporalMeta, provenance?: { tainted: boolean; source?: string }): Promise<void> {
    validateTemporal(temporal)
    if (scope === 'session') {
      this.session.session_memory[key] = JSON.stringify({ content, links, temporal, provenance: provenance?.tainted ? 'untrusted' : 'trusted', source: provenance?.source })
      return
    }
    const graph = this.loadGraph(scope)
    graph.nodes[key] = { key, content, links, temporal, provenance: provenance?.tainted ? 'untrusted' : 'trusted', source: provenance?.source }
    this.saveGraph(scope, graph)
    await this.rebuildIndex(scope)
  }

  async delete(scope: MemoryScope, key: string): Promise<void> {
    if (scope === 'session') {
      delete this.session.session_memory[key]
      return
    }
    const graph = this.loadGraph(scope)
    if (graph.nodes[key]) {
      delete graph.nodes[key]
      this.saveGraph(scope, graph)
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
    const graph = this.loadGraph(scope)
    return Object.values(graph.nodes).map(node => ({
      key: node.key,
      preview: node.content.slice(0, 100),
      content: node.content,
      links: node.links,
      temporal: node.temporal,
    }))
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

    const dir = this.dirForScope(scope)
    writeFileSync(join(dir, 'MEMORY.md'), `# Memory Index\n\n${lines.join('\n')}\n`, 'utf-8')
  }
}
