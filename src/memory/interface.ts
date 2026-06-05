export interface MemoryLink {
  target: string
  relation?: string
}

export interface MemoryEntry {
  key: string
  preview: string
  links?: MemoryLink[]
}

export interface MemoryProvider {
  read(scope: 'session' | 'profile' | 'user' | 'project', key: string): Promise<{content: string, links?: MemoryLink[]} | null>
  write(scope: 'session' | 'profile' | 'user' | 'project', key: string, content: string, links?: MemoryLink[]): Promise<void>
  delete(scope: 'session' | 'profile' | 'user' | 'project', key: string): Promise<void>
  list(scope: 'session' | 'profile' | 'user' | 'project'): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
