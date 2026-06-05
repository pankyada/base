import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { MemoryProvider, MemoryEntry, MemoryLink } from './interface.js'
import { Session } from '../session/types.js'
import { userPaths, projectPaths } from '../session/user-paths.js'

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
    const path = join(this.dirFor(scope), `${key}.md`)
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = matter(raw)
    return {
      content: parsed.content.trim(),
      links: parsed.data.links as MemoryLink[] | undefined
    }
  }

  async write(scope: 'session' | 'profile' | 'user' | 'project', key: string, content: string, links?: MemoryLink[]): Promise<void> {
    if (scope === 'session') {
      this.session.session_memory[key] = JSON.stringify({ content, links })
      return
    }
    const dir = this.dirFor(scope)
    mkdirSync(dir, { recursive: true })
    const fileContent = links && links.length > 0
      ? matter.stringify(content, { links })
      : content
    writeFileSync(join(dir, `${key}.md`), fileContent, 'utf-8')
    await this.rebuildIndex(scope)
  }

  async delete(scope: 'session' | 'profile' | 'user' | 'project', key: string): Promise<void> {
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
          links: parsed.data.links as MemoryLink[] | undefined
        }
      })
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
    const dir = this.dirFor(scope)
    writeFileSync(join(dir, 'MEMORY.md'), `# Memory Index\n\n${lines.join('\n')}\n`, 'utf-8')
  }
}
