import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Ajv } from 'ajv'
import { atomicWriteJson, readJson, RevisionConflictError } from '../shared/atomic-json.js'
import { userPaths } from '../session/user-paths.js'

export type CriterionState = 'pending' | 'verified' | 'failed' | 'needs_human'
export type CriterionKind = 'tool_result_match' | 'artifact_exists' | 'artifact_hash' | 'artifact_schema' | 'human'
export interface Criterion {
  id: string
  description: string
  kind: CriterionKind
  expected?: unknown
  state: CriterionState
  evidence: EvidenceRef[]
  validator?: { id: string; version: string; at: string }
  human_completed_at?: string
  human_completed_by?: string
  failure?: string
}
export interface EvidenceRef {
  id: string
  kind: 'tool_result' | 'test' | 'artifact' | 'human'
  source: { user: string; session?: string; run?: string; tool_call?: string; path?: string }
  content_hash: string
  preview?: string
  at: string
  provenance?: 'trusted' | 'untrusted'
  /** Tool executor outcome. Omitted only for legacy non-tool evidence records. */
  ok?: boolean
}
export interface Mission {
  version: 1
  id: string
  user: string
  profile: string
  project: string
  session_id?: string
  run_id?: string
  outcome: string
  constraints: string[]
  budget_usd?: number
  deadline?: string
  criteria: Criterion[]
  status: 'open' | 'execution_finished' | 'accepted' | 'failed' | 'needs_human'
  revision: number
  created_at: string
  updated_at: string
}
export interface Receipt {
  version: 1
  id: string
  mission_id: string
  user: string
  run_id?: string
  execution: 'finished' | 'failed' | 'cancelled'
  accepted: boolean
  changes: string[]
  evidence: EvidenceRef[]
  cost_usd?: number
  unresolved: string[]
  undo: string[]
  created_at: string
}

const preview = (value: unknown): string => String(typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 512)
export function contentHash(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex') }
export function evidenceRef(input: Omit<EvidenceRef, 'id' | 'at' | 'content_hash'> & { content: unknown }): EvidenceRef {
  return { id: randomUUID(), kind: input.kind, source: input.source, content_hash: contentHash(input.content), preview: preview(input.content), at: new Date().toISOString(), provenance: input.provenance, ...(input.ok === undefined ? {} : { ok: input.ok }) }
}
export type MissionInput = Omit<Mission, 'version' | 'id' | 'revision' | 'created_at' | 'updated_at' | 'status' | 'criteria'> & { criteria: Array<Omit<Criterion, 'state' | 'evidence'> & Partial<Pick<Criterion, 'state' | 'evidence'>>> }
export function createMission(input: MissionInput): Mission {
  const now = new Date().toISOString()
  return { ...input, version: 1, id: randomUUID(), revision: 1, status: 'open', criteria: input.criteria.map(c => ({ ...c, state: c.state ?? 'pending', evidence: c.evidence ?? [] })), created_at: now, updated_at: now }
}

export function assertEvidence(mission: Mission, evidence: EvidenceRef): void {
  if (evidence.source.user !== mission.user) throw new Error('evidence user does not match mission')
  if (mission.session_id && evidence.source.session && evidence.source.session !== mission.session_id) throw new Error('evidence session does not match mission')
  if (mission.run_id && evidence.source.run && evidence.source.run !== mission.run_id) throw new Error('evidence run does not match mission')
  if (evidence.provenance === 'untrusted') throw new Error('untrusted evidence cannot verify a criterion')
}

export function evaluateCriterion(criterion: Criterion, evidence: EvidenceRef[]): Criterion {
  const matches = evidence.filter(ref => { try { assertCriterionEvidence(criterion, ref); return true } catch { return false } })
  if (criterion.kind === 'human') return { ...criterion, state: 'needs_human' }
  if (!matches.length) return { ...criterion, state: 'failed', failure: 'no matching authentic evidence' }
  return { ...criterion, state: 'verified', evidence: matches, validator: { id: `deterministic:${criterion.kind}`, version: '1', at: new Date().toISOString() }, failure: undefined }
}
function assertCriterionEvidence(criterion: Criterion, evidence: EvidenceRef): void {
  if (evidence.ok === false) throw new Error('tool execution failed')
  if (criterion.kind === 'tool_result_match' && criterion.expected !== undefined && !String(evidence.preview ?? '').includes(String(criterion.expected))) throw new Error('tool result mismatch')
  if (criterion.kind === 'artifact_hash' && criterion.expected !== evidence.content_hash) throw new Error('artifact hash mismatch')
  if (criterion.kind === 'artifact_exists' && !evidence.source.path) throw new Error('artifact path missing')
  if (criterion.kind === 'artifact_schema' && !matchesSchema(parseStructuredPreview(evidence.preview), criterion.expected)) throw new Error('schema mismatch')
}

function parseStructuredPreview(value: string | undefined): unknown {
  if (!value) return undefined
  try { return JSON.parse(value) } catch { return undefined }
}

/** Deterministic JSON Schema validation; malformed schemas fail closed. */
const schemaValidator = new Ajv({ allErrors: true, strict: false })
function matchesSchema(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
  try { return schemaValidator.compile(schema)(value) === true } catch { return false }
}
export function completeHumanCriterion(mission: Mission, criterionId: string, user: string, expectedRevision: number): Mission {
  if (mission.revision !== expectedRevision) throw new RevisionConflictError(mission.id, expectedRevision, mission.revision)
  const criterion = mission.criteria.find(c => c.id === criterionId)
  if (!criterion) throw new Error(`criterion '${criterionId}' not found`)
  if (criterion.kind !== 'human') throw new Error('only human criteria accept explicit human completion')
  const at = new Date().toISOString()
  const next: Mission = { ...mission, revision: mission.revision + 1, updated_at: at, criteria: mission.criteria.map(c => c.id === criterionId ? { ...c, state: 'verified', human_completed_at: at, human_completed_by: user } : c) }
  next.status = next.criteria.every(c => c.state === 'verified') ? 'accepted' : 'execution_finished'
  return next
}
export function finalizeMission(mission: Mission, execution: Receipt['execution'], evidence: EvidenceRef[], changes: string[] = [], cost_usd?: number, undo: string[] = []): Receipt {
  for (const ref of evidence) assertEvidence(mission, ref)
  const criteria = mission.criteria.map(c => evaluateCriterion(c, evidence))
  const unresolved = criteria.filter(c => c.state !== 'verified').map(c => c.id)
  return { version: 1, id: randomUUID(), mission_id: mission.id, user: mission.user, run_id: mission.run_id, execution, accepted: execution === 'finished' && unresolved.length === 0, changes, evidence, cost_usd, unresolved, undo, created_at: new Date().toISOString() }
}

export class MissionStore {
  constructor(private readonly user: string) {}
  private path(id: string): string { return join(userPaths(this.user, '').missionsDir, `${id}.json`) }
  save(mission: Mission, expectedRevision?: number): Mission {
    const existing = this.get(mission.id)
    const actual = existing?.revision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError(mission.id, expectedRevision, actual)
    if (existing && mission.revision !== actual + 1) throw new RevisionConflictError(mission.id, actual + 1, mission.revision)
    if (!existing && mission.revision !== 1) throw new RevisionConflictError(mission.id, 1, mission.revision)
    const next = { ...mission, updated_at: new Date().toISOString() }
    atomicWriteJson(this.path(mission.id), next)
    return next
  }
  get(id: string): Mission | null { const path = this.path(id); if (!existsSync(path)) return null; const record = readJson<Mission>(path); if (record.user !== this.user) return null; return record }
  list(): Mission[] { const dir = userPaths(this.user, '').missionsDir; if (!existsSync(dir)) return []; return readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => { try { const value = readJson<Mission>(join(dir, f)); return value.user === this.user && value.version === 1 ? [value] : [] } catch { return [] } }).sort((a, b) => b.updated_at.localeCompare(a.updated_at)) }
  saveReceipt(receipt: Receipt): void { if (receipt.user !== this.user) throw new Error('receipt user does not match store'); atomicWriteJson(join(userPaths(this.user, '').missionsDir, `${receipt.mission_id}.receipt.${receipt.id}.json`), receipt) }
  receipts(missionId: string): Receipt[] { const dir = userPaths(this.user, '').missionsDir; if (!existsSync(dir)) return []; return readdirSync(dir).filter(f => f.startsWith(`${missionId}.receipt.`)).flatMap(f => { try { return [readJson<Receipt>(join(dir, f))] } catch { return [] } }) }
}
