import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { sanitizeUserId } from '../session/user-paths.js'

export type PendingState = 'open' | 'answered' | 'expired' | 'cancelled'
export type PendingAnsweredVia = 'channel' | 'rest' | 'ws' | 'cli'
export type PendingPurpose = 'ask' | 'approval'

export interface PendingInput {
  id: string
  run_id: string
  session_id: string
  user: string
  profile: string
  prompt: string
  kind: 'text' | 'select' | 'multi_select'
  options?: string[]
  tool_call_id?: string
  purpose?: PendingPurpose
  tool_name?: string
  tool_input?: Record<string, unknown>
  is_mcp?: boolean
  channel?: string
  created_at: string
  expires_at: string
  state: PendingState
  answer?: string
  answered_at: string | null
  answered_via?: PendingAnsweredVia
}

export type PendingInputCreate = Omit<PendingInput, 'state' | 'answered_at' | 'answer' | 'answered_via'> & {
  state?: PendingState
}

export type PendingRecord = PendingInput & { path: string }

function defaultRoot(): string {
  return join(homedir(), '.harness', 'pending')
}

function copyWithoutPath(record: PendingRecord): PendingInput {
  const { path: _path, ...input } = record
  return input
}

export class PendingStore {
  constructor(
    private readonly root = defaultRoot(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: PendingInputCreate): PendingRecord {
    const user = sanitizeUserId(input.user)
    const record: PendingInput = {
      ...input,
      user,
      state: input.state ?? 'open',
      answered_at: null,
    }
    const dir = join(this.root, user)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${record.created_at.slice(0, 10)}_${record.id}.json`)
    writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8')
    return { ...record, path }
  }

  get(id: string): PendingRecord | null {
    for (const record of this.listAll()) {
      if (record.id === id) return record
    }
    return null
  }

  list(opts: { user?: string; state?: PendingState; limit?: number } = {}): PendingRecord[] {
    const records = this.listAll().filter(record => {
      if (opts.user && record.user !== sanitizeUserId(opts.user)) return false
      if (opts.state && record.state !== opts.state) return false
      return true
    })
    return records.slice(0, opts.limit ?? 100)
  }

  answer(id: string, answer: string, answeredVia: PendingAnsweredVia): PendingRecord | null {
    const record = this.get(id)
    if (!record || record.state !== 'open') return null
    if (new Date(record.expires_at).getTime() <= this.now().getTime()) {
      return this.update(record, { state: 'expired' })
    }
    return this.update(record, {
      state: 'answered', answer, answered_at: this.now().toISOString(), answered_via: answeredVia,
    })
  }

  cancel(id: string): PendingRecord | null {
    const record = this.get(id)
    if (!record || record.state !== 'open') return null
    return this.update(record, { state: 'cancelled' })
  }

  sweep(at = this.now()): PendingRecord[] {
    return this.list({ state: 'open', limit: 10000 })
      .filter(record => new Date(record.expires_at).getTime() <= at.getTime())
      .map(record => this.update(record, { state: 'expired' }))
  }

  private update(record: PendingRecord, patch: Partial<PendingInput>): PendingRecord {
    const updated = { ...copyWithoutPath(record), ...patch }
    writeFileSync(record.path, JSON.stringify(updated, null, 2), 'utf-8')
    return { ...updated, path: record.path }
  }

  private listAll(): PendingRecord[] {
    if (!existsSync(this.root)) return []
    const records: PendingRecord[] = []
    for (const userDir of readdirSync(this.root, { withFileTypes: true })) {
      if (!userDir.isDirectory()) continue
      const dir = join(this.root, userDir.name)
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        const path = join(dir, file)
        try {
          records.push({ ...(JSON.parse(readFileSync(path, 'utf-8')) as PendingInput), path })
        } catch { /* ignore corrupt records, matching RunStore read behavior */ }
      }
    }
    return records.sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
}
