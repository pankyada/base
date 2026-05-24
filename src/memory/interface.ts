export interface MemoryEntry {
  key: string
  preview: string
}

export interface MemoryProvider {
  read(scope: 'session' | 'profile', key: string): Promise<string | null>
  write(scope: 'session' | 'profile', key: string, content: string): Promise<void>
  list(scope: 'session' | 'profile'): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
