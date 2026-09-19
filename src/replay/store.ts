import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson, readJson } from '../shared/atomic-json.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { harnessStatePath } from '../config/state-paths.js'
import { exportJournal, importJournal, type RunJournal } from './index.js'

function replayRoot(user: string): string { return harnessStatePath('replays', sanitizeUserId(user)) }

/** Durable journal store. Corrupt/untrusted files are skipped by list and surfaced by get. */
export class ReplayStore {
  constructor(private readonly user: string, private readonly rootOverride?: string) {}
  private root(): string { return this.rootOverride ?? replayRoot(this.user) }
  private path(id: string): string { return join(this.root(), `journal-${id}.json`) }
  save(journal: RunJournal): RunJournal {
    if (journal.user !== this.user) throw new Error('journal user does not match store')
    atomicWriteJson(this.path(journal.id), exportJournal(journal)); return journal
  }
  get(id: string): RunJournal | null {
    const path = this.path(id); if (!existsSync(path)) return null
    const result = importJournal(readJson<unknown>(path)); if (result.journal.user !== this.user) return null; return result.journal
  }
  list(): RunJournal[] {
    const root = this.root(); if (!existsSync(root)) return []
    return readdirSync(root).filter(file => file.startsWith('journal-') && file.endsWith('.json')).flatMap(file => { try { const item = importJournal(readJson<unknown>(join(root, file))).journal; return item.user === this.user ? [item] : [] } catch { return [] } }).sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''))
  }
}

export { replayRoot }
