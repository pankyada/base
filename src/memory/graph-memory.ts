import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { MemoryProvider, MemoryEntry, MemoryLink } from './interface.js'
import { Session } from '../session/types.js'
import { userPaths, projectPaths } from '../session/user-paths.js'

interface GraphNode {
  key: string
  content: string
  links?: MemoryLink[]
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

  async read(scope: 'session' | 'profile' | 'user' | 'project', key: string): Promise<{content: string, links?: MemoryLink[]} | null> {
    if (scope === 'session') {
      const val = this.session.session_memory[key]
      if (!val) return null
      try {
        const parsed = JSON.parse(val)
        return { content: parsed.content, links: parsed.links }
      } catch {
        return { content: val }
      }
    }
    const graph = this.loadGraph(scope)
    const node = graph.nodes[key]
    if (!node) return null
    return { content: node.content, links: node.links }
  }

  async write(scope: 'session' | 'profile' | 'user' | 'project', key: string, content: string, links?: MemoryLink[]): Promise<void> {
    if (scope === 'session') {
      this.session.session_memory[key] = JSON.stringify({ content, links })
      return
    }
    const graph = this.loadGraph(scope)
    graph.nodes[key] = { key, content, links }
    this.saveGraph(scope, graph)
    await this.rebuildIndex(scope)
  }

  async delete(scope: 'session' | 'profile' | 'user' | 'project', key: string): Promise<void> {
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

  async list(scope: 'session' | 'profile' | 'user' | 'project'): Promise<MemoryEntry[]> {
    if (scope === 'session') {
      return Object.entries(this.session.session_memory).map(([key, val]) => {
        let preview = val.slice(0, 100)
        let links: MemoryLink[] | undefined
        try {
          const parsed = JSON.parse(val)
          preview = (parsed.content as string).slice(0, 100)
          links = parsed.links
        } catch { /* ignore */ }
        return { key, preview, links }
      })
    }
    const graph = this.loadGraph(scope)
    return Object.values(graph.nodes).map(node => ({
      key: node.key,
      preview: node.content.slice(0, 100),
      links: node.links
    }))
  }

  async buildSystemPromptSection(): Promise<string> {
    const parts: string[] = []

    const sharedIndex = join(this.sharedMemDir, 'MEMORY.md')
    if (existsSync(sharedIndex)) {
      parts.push(`## Memory (shared)\n${readFileSync(sharedIndex, 'utf-8')}`)
    }

    const privateIndex = join(this.privateMemDir, 'MEMORY.md')
    if (existsSync(privateIndex)) {
      parts.push(`## Memory (yours)\n${readFileSync(privateIndex, 'utf-8')}`)
    }

    if ((this.session.project ?? 'inbox') !== 'inbox') {
      const projectIndex = join(this.projectMemDir, 'MEMORY.md')
      if (existsSync(projectIndex)) {
        parts.push(`## Memory (project)\n${readFileSync(projectIndex, 'utf-8')}`)
      }
    }

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
