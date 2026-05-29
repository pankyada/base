import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { MemoryProvider, MemoryEntry } from './interface.js'
import { Session } from '../session/types.js'
import { userPaths } from '../session/user-paths.js'

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

  private dirFor(scope: 'profile' | 'user'): string {
    return scope === 'profile' ? this.sharedMemDir : this.privateMemDir
  }

  async read(scope: 'session' | 'profile' | 'user', key: string): Promise<string | null> {
    if (scope === 'session') {
      return this.session.session_memory[key] ?? null
    }
    const path = join(this.dirFor(scope), `${key}.md`)
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  }

  async write(scope: 'session' | 'profile' | 'user', key: string, content: string): Promise<void> {
    if (scope === 'session') {
      this.session.session_memory[key] = content
      return
    }
    const dir = this.dirFor(scope)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${key}.md`), content, 'utf-8')
    await this.rebuildIndex(scope)
  }

  async delete(scope: 'session' | 'profile' | 'user', key: string): Promise<void> {
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

  async list(scope: 'session' | 'profile' | 'user'): Promise<MemoryEntry[]> {
    if (scope === 'session') {
      return Object.entries(this.session.session_memory).map(([key, val]) => ({
        key,
        preview: val.slice(0, 100),
      }))
    }
    const dir = this.dirFor(scope)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .map(f => {
        const key = f.replace(/\.md$/, '')
        const content = readFileSync(join(dir, f), 'utf-8')
        return { key, preview: content.slice(0, 100) }
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

    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''
  }

  private async rebuildIndex(scope: 'profile' | 'user'): Promise<void> {
    const entries = await this.list(scope)
    const lines = entries.map(e => `- **${e.key}**: ${e.preview.replace(/\n/g, ' ')}`)
    const dir = this.dirFor(scope)
    writeFileSync(join(dir, 'MEMORY.md'), `# Memory Index\n\n${lines.join('\n')}\n`, 'utf-8')
  }
}
