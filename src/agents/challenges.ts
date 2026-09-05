import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { atomicWriteJson } from '../shared/atomic-json.js'
import type { EvidenceRef } from '../missions/index.js'

export type ChallengeState = 'open' | 'addressed' | 'unresolved'
export interface ChallengeRecord { version: 1; id: string; mission_id: string; criterion_id?: string; claim_ref?: string; challenger: string; question: string; evidence: EvidenceRef[]; state: ChallengeState; resolution_evidence?: EvidenceRef[]; history: Array<{ state: ChallengeState; by: string; at: string; note?: string }>; round: number; cost_usd: number }
export class ChallengeDesk {
  private readonly challenges = new Map<string, ChallengeRecord>()
  constructor(private readonly maxRounds = 3, private readonly maxCostUsd = 1, private readonly storagePath?: string) { if (storagePath && existsSync(storagePath)) { try { for (const item of JSON.parse(readFileSync(storagePath, 'utf8')) as ChallengeRecord[]) this.challenges.set(item.id, item) } catch { /* corrupt challenge state is not trusted */ } } }
  private persist(): void { if (this.storagePath) atomicWriteJson(this.storagePath, [...this.challenges.values()]) }
  open(input: { missionId: string; challenger: string; question: string; criterionId?: string; claimRef?: string }): ChallengeRecord { const record: ChallengeRecord = { version: 1, id: randomUUID(), mission_id: input.missionId, criterion_id: input.criterionId, claim_ref: input.claimRef, challenger: input.challenger, question: input.question.trim(), evidence: [], state: 'open', history: [{ state: 'open', by: input.challenger, at: new Date().toISOString() }], round: 1, cost_usd: 0 }; if (!record.question) throw new Error('challenge question is required'); this.challenges.set(record.id, record); this.persist(); return record }
  answer(id: string, input: { by: string; evidence?: EvidenceRef[]; unresolved?: boolean; note?: string; costUsd?: number }): ChallengeRecord { const record = this.get(id); const cost = input.costUsd ?? 0; if (record.state !== 'open') throw new Error('challenge is already closed'); if (record.round > this.maxRounds || record.cost_usd + cost > this.maxCostUsd) { record.state = 'unresolved'; this.addHistory(record, input.by, 'unresolved', input.note ?? 'challenge budget or round cap reached'); this.persist(); return record }; if (!input.unresolved && (!input.evidence || input.evidence.length === 0)) throw new Error('evidence-required challenge needs receipt evidence'); record.cost_usd += cost; record.resolution_evidence = input.evidence; record.state = input.unresolved ? 'unresolved' : 'addressed'; this.addHistory(record, input.by, record.state, input.note); this.persist(); return record }
  reopen(id: string, by: string): ChallengeRecord { const record = this.get(id); if (record.round >= this.maxRounds) { record.state = 'unresolved'; this.persist(); return record }; record.round++; record.state = 'open'; this.addHistory(record, by, 'open', 'challenge reopened'); this.persist(); return record }
  get(id: string): ChallengeRecord { const record = this.challenges.get(id); if (!record) throw new Error(`challenge '${id}' not found`); return record }
  list(missionId?: string): ChallengeRecord[] { return [...this.challenges.values()].filter(c => !missionId || c.mission_id === missionId) }
  requiredBlock(missionId: string): boolean { return this.list(missionId).some(c => c.state === 'open' || c.state === 'unresolved') }
  private addHistory(record: ChallengeRecord, by: string, state: ChallengeState, note?: string): void { record.history.push({ state, by, at: new Date().toISOString(), note }) }
}
