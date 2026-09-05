import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { atomicWriteJson } from '../shared/atomic-json.js'
import type { Session } from '../session/types.js'

export type ReplayMode = 'playback' | 'fixture' | 'live-branch'
export type EffectState = 'started' | 'completed' | 'failed' | 'unknown'
export interface RecordedEvent { seq: number; kind: 'token' | 'tool_start' | 'tool_end' | 'stage' | 'result'; name?: string; payload: unknown; at: string; hash?: string }
export interface EffectReceipt { id: string; tool: string; argument_hash: string; state: EffectState; started_at: string; completed_at?: string; result_hash?: string; reconciliation?: 'reconciled' | 'rejected'; seq?: number }
export interface RunJournal {
  version: 1; id: string; user: string; session_id: string; profile: string; config_fingerprint: string
  events: RecordedEvent[]; effects: EffectReceipt[]; completed_checkpoints: string[]; checkpoint_boundaries?: Record<string, number>
  mode: ReplayMode; parent_run_id?: string; parent_checkpoint?: string; created_at?: string
}
export interface ImportedJournal { journal: RunJournal; warnings: string[] }
export class ReplayValidationError extends Error { constructor(message: string) { super(message); this.name = 'ReplayValidationError' } }
export class FixtureMismatchError extends Error { constructor(message: string) { super(message); this.name = 'FixtureMismatchError' } }

export function hashArguments(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex') }
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'providerState' && key !== 'encrypted_content').map(([key, item]) => /key|token|secret|password|api[_-]?key|authorization/i.test(key) ? [key, '[REDACTED]'] : [key, redactSensitive(item)]))
}
function eventHash(event: Omit<RecordedEvent, 'hash'>): string { return createHash('sha256').update(stableJson(event)).digest('hex') }
export function newJournal(input: Omit<RunJournal, 'version' | 'id' | 'events' | 'effects' | 'completed_checkpoints'>): RunJournal { return { ...input, version: 1, id: randomUUID(), events: [], effects: [], completed_checkpoints: [], created_at: input.created_at ?? new Date().toISOString() } }
export function recordEvent(journal: RunJournal, kind: RecordedEvent['kind'], payload: unknown, name?: string): RecordedEvent {
  const eventBase = { seq: journal.events.length + 1, kind, payload, ...(name ? { name } : {}), at: new Date().toISOString() }; const event = { ...eventBase, hash: eventHash(eventBase) }; journal.events.push(event); return event
}
export function markCheckpoint(journal: RunJournal, checkpoint: string): RunJournal {
  if (!checkpoint.trim()) throw new ReplayValidationError('checkpoint name cannot be empty')
  if (!journal.completed_checkpoints.includes(checkpoint)) journal.completed_checkpoints.push(checkpoint)
  journal.checkpoint_boundaries = { ...(journal.checkpoint_boundaries ?? {}), [checkpoint]: journal.events.length }; return journal
}
export function recordEffect(journal: RunJournal, input: Omit<EffectReceipt, 'id' | 'started_at'>): EffectReceipt { const effect = { ...input, id: randomUUID(), started_at: new Date().toISOString(), seq: input.seq ?? journal.events.length }; journal.effects.push(effect); return effect }
export async function playback(journal: RunJournal, emit: (event: RecordedEvent) => Promise<void> | void): Promise<{ mode: 'playback'; events: number }> { validateJournal(journal); for (const event of journal.events) await emit({ ...event, payload: redactSensitive(event.payload) }); return { mode: 'playback', events: journal.events.length } }
export function matchFixture(journal: RunJournal, tool: string, args: unknown): { ok: true; receipt: EffectReceipt } | { ok: false; reason: string } {
  const hash = hashArguments(args); const candidates = journal.effects.filter(effect => effect.tool === tool); if (!candidates.length) return { ok: false, reason: `no recorded fixture for ${tool}` }; const receipt = candidates.find(effect => effect.argument_hash === hash); if (!receipt) return { ok: false, reason: `fixture argument hash mismatch for ${tool}` }; if (receipt.state === 'unknown') return { ok: false, reason: `effect ${receipt.id} is unknown and requires reconciliation` }; if (receipt.reconciliation === 'rejected') return { ok: false, reason: `effect ${receipt.id} was rejected during reconciliation` }; return { ok: true, receipt }
}
export function requireFixture(journal: RunJournal, tool: string, args: unknown): EffectReceipt { const result = matchFixture(journal, tool, args); if (!result.ok) throw new FixtureMismatchError(result.reason); return result.receipt }
export function branch(journal: RunJournal, checkpoint: string, override: Partial<Pick<RunJournal, 'profile' | 'config_fingerprint'>> = {}): RunJournal {
  validateJournal(journal); if (!journal.completed_checkpoints.includes(checkpoint)) throw new ReplayValidationError(`checkpoint '${checkpoint}' is not completed`); const boundary = journal.checkpoint_boundaries?.[checkpoint] ?? journal.events.length; const branched = newJournal({ user: journal.user, session_id: randomUUID(), profile: override.profile ?? journal.profile, config_fingerprint: override.config_fingerprint ?? journal.config_fingerprint, mode: 'live-branch', parent_run_id: journal.id, parent_checkpoint: checkpoint }); branched.events = journal.events.filter(event => event.seq <= boundary).map(event => ({ ...event })); branched.effects = journal.effects.filter(effect => (effect.seq ?? Number.MAX_SAFE_INTEGER) <= boundary).map(effect => ({ ...effect })); branched.completed_checkpoints = journal.completed_checkpoints.slice(0, journal.completed_checkpoints.indexOf(checkpoint) + 1); branched.checkpoint_boundaries = { [checkpoint]: boundary }; return branched
}
export function branchSession(session: Session, parentRunId: string, profile = session.profile): Session {
  const messages = JSON.parse(JSON.stringify(session.messages)) as any[]
  for (const message of messages) if (message && typeof message === 'object') delete message.providerState
  return { ...session, id: randomUUID().replace(/-/g, '').slice(0, 8), profile, messages, tool_calls: JSON.parse(JSON.stringify(session.tool_calls)), session_memory: { ...session.session_memory }, revision: 1, summary: `Branch of ${parentRunId}` }
}
export function validateJournal(value: unknown, options: { maxEvents?: number; maxEffects?: number } = {}): RunJournal {
  if (!value || typeof value !== 'object') throw new ReplayValidationError('journal must be an object'); const journal = value as Partial<RunJournal>; if (journal.version !== 1) throw new ReplayValidationError(`unsupported journal version: ${String(journal.version)}`); if (typeof journal.id !== 'string' || typeof journal.user !== 'string' || typeof journal.session_id !== 'string') throw new ReplayValidationError('journal identity fields are required'); if (!Array.isArray(journal.events) || journal.events.length > (options.maxEvents ?? 20_000)) throw new ReplayValidationError('journal events exceed import limit'); if (!Array.isArray(journal.effects) || journal.effects.length > (options.maxEffects ?? 20_000)) throw new ReplayValidationError('journal effects exceed import limit'); for (const event of journal.events) { if (!Number.isInteger(event.seq) || event.seq < 1 || typeof event.kind !== 'string') throw new ReplayValidationError('invalid recorded event'); if (event.hash && (!/^[a-f0-9]{64}$/.test(event.hash) || event.hash !== eventHash({ seq: event.seq, kind: event.kind, ...(event.name ? { name: event.name } : {}), payload: event.payload, at: event.at }))) throw new ReplayValidationError(`invalid event hash at sequence ${event.seq}`) } for (const effect of journal.effects) { if (!effect.tool || !/^[a-f0-9]{64}$/.test(effect.argument_hash)) throw new ReplayValidationError('invalid effect receipt hash'); if (effect.state === 'unknown' && effect.reconciliation) throw new ReplayValidationError('unknown effect cannot already be reconciled') } return journal as RunJournal
}
export function exportJournal(journal: RunJournal, path?: string): RunJournal { validateJournal(journal); const events = journal.events.map(event => { const safe = { ...event, payload: redactSensitive(event.payload) }; const { hash: _hash, ...base } = safe; return { ...safe, hash: eventHash(base) } }); const safe = { ...journal, events }; if (path) atomicWriteJson(path, safe); return safe }
export function importJournal(value: unknown, options: { maxEvents?: number; maxEffects?: number; maxBytes?: number } = {}): ImportedJournal { const raw = JSON.stringify(value); if (Buffer.byteLength(raw) > (options.maxBytes ?? 5_000_000)) throw new ReplayValidationError('journal exceeds import size limit'); const journal = validateJournal(value, options); return { journal: { ...journal, mode: journal.mode ?? 'fixture' }, warnings: ['Imported content is untrusted; no live execution fallback is permitted.'] } }
export function importJournalFromPath(path: string, options: { ownedRoot?: string; maxEvents?: number; maxEffects?: number; maxBytes?: number } = {}): ImportedJournal { const root = resolve(options.ownedRoot ?? process.cwd()); const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path); if (relative(root, absolute).startsWith('..')) throw new ReplayValidationError('journal path is outside the owned import directory'); if (!existsSync(absolute)) throw new ReplayValidationError(`journal not found: ${path}`); const real = realpathSync(absolute); if (relative(root, real).startsWith('..')) throw new ReplayValidationError('journal path resolves outside the owned import directory'); let value: unknown; try { value = JSON.parse(readFileSync(real, 'utf8')) } catch { throw new ReplayValidationError('journal is not valid JSON') }; return importJournal(value, options) }
export function reconcileEffect(journal: RunJournal, effectId: string, decision: 'reconciled' | 'rejected'): RunJournal { const effect = journal.effects.find(item => item.id === effectId); if (!effect || effect.state !== 'unknown') throw new ReplayValidationError('only unknown effects can be reconciled'); effect.reconciliation = decision; effect.state = decision === 'reconciled' ? 'completed' : 'failed'; return journal }
