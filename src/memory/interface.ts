export interface MemoryLink {
  source?: string
  target: string
  relation?: string
}

export type MemoryScope = 'session' | 'profile' | 'user' | 'project'

export interface TemporalMeta {
  valid_from?: string
  valid_until?: string
  recur?: string
  /** IANA zone for wall-clock recurrence. Offset-only facts use a fixed offset. */
  timezone?: string
  entity?: string
  confidence?: number
  supersedes?: string
}

export interface ClaimMeta {
  entity: string
  predicate: string
  normalized_value?: string
  source_evidence?: string[]
  last_verified_at?: string
  tainted?: boolean
}

export interface RecallQuery {
  at?: string
  window?: string
  entity?: string
  relation?: string
  text?: string
  limit?: number
}

export interface MemoryRecord {
  content: string
  links?: MemoryLink[]
  temporal?: TemporalMeta
  provenance?: 'trusted' | 'untrusted'
  source?: string
  claim?: ClaimMeta
}

export interface MemoryEntry {
  key: string
  preview: string
  content?: string
  links?: MemoryLink[]
  temporal?: TemporalMeta
  claim?: ClaimMeta
}

export interface MemoryProvider {
  read(scope: MemoryScope, key: string): Promise<MemoryRecord | null>
  write(scope: MemoryScope, key: string, content: string, links?: MemoryLink[], temporal?: TemporalMeta, provenance?: { tainted: boolean; source?: string }, claim?: ClaimMeta): Promise<void>
  delete(scope: MemoryScope, key: string): Promise<void>
  list(scope: MemoryScope): Promise<MemoryEntry[]>
  query(scope: MemoryScope, query: RecallQuery): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
