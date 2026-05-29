export interface MemoryEntry {
  key: string
  preview: string
}

export interface MemoryProvider {
  read(scope: 'session' | 'profile' | 'user', key: string): Promise<string | null>
  write(scope: 'session' | 'profile' | 'user', key: string, content: string): Promise<void>
  delete(scope: 'session' | 'profile' | 'user', key: string): Promise<void>
  list(scope: 'session' | 'profile' | 'user'): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
