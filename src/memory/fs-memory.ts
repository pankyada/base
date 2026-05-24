import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { MemoryProvider, MemoryEntry } from './interface.js'
import { Session } from '../session/types.js'

export class FsMemoryProvider implements MemoryProvider {
  constructor(
    private readonly artifactDir: string,
    private readonly session: Session
  ) {}

  private get memDir(): string {
    return join(this.artifactDir, 'memory')
  }

  async read(scope: 'session' | 'profile', key: string): Promise<string | null> {
    if (scope === 'session') {
      return this.session.session_memory[key] ?? null
    }
    const path = join(this.memDir, `${key}.md`)
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  }

  async write(scope: 'session' | 'profile', key: string, content: string): Promise<void> {
    if (scope === 'session') {
      this.session.session_memory[key] = content
      return
    }
    mkdirSync(this.memDir, { recursive: true })
    writeFileSync(join(this.memDir, `${key}.md`), content, 'utf-8')
    await this.rebuildIndex()
  }

  async list(scope: 'session' | 'profile'): Promise<MemoryEntry[]> {
    if (scope === 'session') {
      return Object.entries(this.session.session_memory).map(([key, val]) => ({
        key,
        preview: val.slice(0, 100),
      }))
    }
    if (!existsSync(this.memDir)) return []
    return readdirSync(this.memDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .map(f => {
        const key = f.replace(/\.md$/, '')
        const content = readFileSync(join(this.memDir, f), 'utf-8')
        return { key, preview: content.slice(0, 100) }
      })
  }

  async buildSystemPromptSection(): Promise<string> {
    const indexPath = join(this.memDir, 'MEMORY.md')
    if (!existsSync(indexPath)) return ''
    const content = readFileSync(indexPath, 'utf-8')
    return `\n\n## Memory\n${content}`
  }

  private async rebuildIndex(): Promise<void> {
    const entries = await this.list('profile')
    const lines = entries.map(e => `- **${e.key}**: ${e.preview.replace(/\n/g, ' ')}`)
    writeFileSync(join(this.memDir, 'MEMORY.md'), `# Memory Index\n\n${lines.join('\n')}\n`, 'utf-8')
  }
}
