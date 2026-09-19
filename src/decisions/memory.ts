import { createHash } from 'node:crypto'
import type { MemoryEntry, MemoryLink, MemoryProvider, MemoryRecord, MemoryScope, RecallQuery, TemporalMeta, ClaimMeta } from '../memory/interface.js'
import type { DecisionAnswer, DecisionEvaluateOptions, DecisionOutcome, DecisionProvider, DecisionQuestion } from './types.js'
import { detectConflicts, recordUnresolvedConflict, type MemoryConflict, type MemoryConflictStore } from '../memory/conflicts.js'
import { imminentEntries, isValidAt } from '../memory/query.js'

/** Stable, local evidence supplied by the caller. Jev never creates evidence. */
export interface MemoryEvidence {
  ids: string[]
  /** Bounded source text supplied by Base. IDs without spans are not evidence. */
  spans?: Array<{ id: string; text: string; role?: string; provenance?: 'trusted' | 'untrusted'; source?: string }>
  revision?: string
}

export interface AutomaticMemoryCandidate {
  scope: MemoryScope
  key: string
  content: string
  links?: MemoryLink[]
  temporal?: TemporalMeta
  claim?: ClaimMeta
  provenance?: 'trusted' | 'untrusted'
  source?: string
  evidence: MemoryEvidence
}

export interface MemoryJudgement {
  support: boolean
  durable: boolean
  useful: boolean
  duplicate: boolean
  conflict: boolean
  reason?: string
}

export interface MemoryDecisionAdvisor {
  judge(candidate: AutomaticMemoryCandidate, context?: { existing: MemoryEntry[] }): Promise<MemoryJudgement | undefined>
  rank?(query: RecallQuery, candidates: MemoryEntry[]): Promise<Array<{ key: string; score?: number }> | undefined>
  retain?(candidates: MemoryEntry[]): Promise<string[] | undefined>
  conflict?(a: MemoryEntry, b: MemoryEntry): Promise<{ conflict: boolean; rationale?: string } | undefined>
}

export class MemoryDecisionControlError extends Error {
  constructor(readonly reason: string) { super(`memory decision control: ${reason}`); this.name = 'MemoryDecisionControlError' }
}

export type MemoryCaptureResult =
  | { status: 'promoted'; key: string; id: string }
  | { status: 'rejected' | 'pending'; key: string; id: string; reason: string }
  | { status: 'explicit'; key: string; id: string }

function candidateId(candidate: Pick<AutomaticMemoryCandidate, 'scope' | 'key' | 'content' | 'evidence'>): string {
  const digest = createHash('sha256').update(`${candidate.scope}\0${candidate.key}\0${candidate.content}\0${candidate.evidence.revision ?? ''}\0${candidate.evidence.ids.join('\0')}`).digest('hex').slice(0, 24)
  return `memory-candidate:${digest}`
}

function evidenceMatches(entry: MemoryEntry, candidate: AutomaticMemoryCandidate): boolean {
  if (entry.key !== candidate.key && entry.content !== candidate.content) return false
  const known = new Set([...(entry.source_evidence ?? []), ...(entry.claim?.source_evidence ?? [])])
  return candidate.evidence.ids.some(id => known.has(id))
}

function memoryFingerprint(entry: MemoryEntry | MemoryRecord | null): string {
  if (!entry) return 'missing'
  return createHash('sha256').update(JSON.stringify({ content: entry.content ?? ('preview' in entry ? entry.preview : ''), source_revision: entry.source_revision, retention: entry.retention, claim: entry.claim })).digest('hex')
}

function isControlOutcome(outcome: DecisionOutcome): outcome is Extract<DecisionOutcome, { kind: 'control' }> {
  return outcome.kind === 'control'
}

function answerNoul(outcome: Extract<DecisionOutcome, { kind: 'success' }>, key: string): boolean {
  const answer: DecisionAnswer | undefined = outcome.response.answers[key]
  return answer?.type === 'noul' && Number.isFinite(answer.noul) && answer.noul >= 0.5
}

function boundedState(candidate: AutomaticMemoryCandidate, existing: MemoryEntry[]): Record<string, unknown> {
  return {
    candidate: { scope: candidate.scope, key: candidate.key, content: candidate.content.slice(0, 4_000), claim: candidate.claim, provenance: candidate.provenance, source: candidate.source, evidence: { revision: candidate.evidence.revision, spans: (candidate.evidence.spans ?? []).map(span => ({ id: span.id, text: span.text.slice(0, 2_000), role: span.role, provenance: span.provenance })) } },
    existing: existing.slice(0, 32).map(entry => ({ key: entry.key, content: (entry.content ?? entry.preview).slice(0, 1_000), claim: entry.claim, source_evidence: entry.source_evidence })),
  }
}

/** Adapter from the mounted DecisionProvider/runtime to memory-specific typed judgments. */
export function createMemoryDecisionAdvisor(options: { provider: DecisionProvider; model: string; signal?: AbortSignal; threshold?: number; evaluateOptions?: Omit<DecisionEvaluateOptions, 'signal'> }): MemoryDecisionAdvisor {
  const threshold = options.threshold ?? 0.5
  const evaluate = async (state: Record<string, unknown>, questions: Record<string, DecisionQuestion>): Promise<Extract<DecisionOutcome, { kind: 'success' }>> => {
    const outcome = await options.provider.evaluate({ model: options.model, state: state as any, questions }, { ...options.evaluateOptions, signal: options.signal })
    if (isControlOutcome(outcome)) throw new MemoryDecisionControlError(outcome.reason)
    if (outcome.kind !== 'success') throw new Error(`memory decision unavailable: ${outcome.reason}`)
    return outcome
  }
  return {
    async judge(candidate, context) {
      const state = boundedState(candidate, context?.existing ?? [])
      const questions: Record<string, DecisionQuestion> = Object.fromEntries(['support', 'durable', 'useful', 'duplicate', 'conflict'].map(key => [key, { type: 'noul', instructions: `Judge the memory candidate for ${key}. Use only the supplied candidate and source spans.` }])) as Record<string, DecisionQuestion>
      const outcome = await evaluate(state, questions)
      return { support: answerNoul(outcome, 'support'), durable: answerNoul(outcome, 'durable'), useful: answerNoul(outcome, 'useful'), duplicate: answerNoul(outcome, 'duplicate'), conflict: answerNoul(outcome, 'conflict') }
    },
    async rank(query, candidates) {
      const state = { query, candidates: candidates.slice(0, 32).map(entry => ({ key: entry.key, content: (entry.content ?? entry.preview).slice(0, 1_500), claim: entry.claim })) }
      const questions: Record<string, DecisionQuestion> = Object.fromEntries(candidates.slice(0, 32).map((entry, index) => [`candidate_${index}`, { type: 'score', instructions: `Score usefulness of memory ${entry.key} for the query from 0 to 1.`, criteria: ['0', '1'] }])) as Record<string, DecisionQuestion>
      const outcome = await evaluate(state, questions)
      return candidates.slice(0, 32).map((entry, index) => ({ key: entry.key, score: (() => { const answer = outcome.response.answers[`candidate_${index}`]; return answer?.type === 'score' && Number.isFinite(answer.score) ? answer.score : 0 })() })).filter(item => item.score >= threshold).sort((a, b) => b.score - a.score)
    },
    async retain(candidates) {
      const state = { candidates: candidates.slice(0, 32).map(entry => ({ key: entry.key, content: (entry.content ?? entry.preview).slice(0, 1_500), retention: entry.retention, claim: entry.claim })) }
      const questions: Record<string, DecisionQuestion> = Object.fromEntries(candidates.slice(0, 32).map((entry, index) => [`candidate_${index}`, { type: 'noul', instructions: `Should memory ${entry.key} remain actively recalled? Return false only when safe to archive.` }])) as Record<string, DecisionQuestion>
      const outcome = await evaluate(state, questions)
      return candidates.slice(0, 32).filter((_, index) => !answerNoul(outcome, `candidate_${index}`)).map(entry => entry.key)
    },
    async conflict(a, b) {
      const outcome = await evaluate({ a: { key: a.key, content: (a.content ?? a.preview).slice(0, 1_500), claim: a.claim, source_evidence: a.source_evidence }, b: { key: b.key, content: (b.content ?? b.preview).slice(0, 1_500), claim: b.claim, source_evidence: b.source_evidence } }, {
        conflict: { type: 'noul', instructions: 'Do these two structurally related claims conflict within their valid windows? Return true only for a genuine unresolved contradiction.' },
      })
      return { conflict: answerNoul(outcome, 'conflict') }
    },
  }
}

/** Shared source-grounded capture, recall and reversible retention policy. */
export class MemoryCaptureService {
  constructor(private readonly advisor?: MemoryDecisionAdvisor, private readonly options: { recallMode?: 'shadow' | 'enforce'; captureMode?: 'shadow' | 'enforce'; retentionMode?: 'shadow' | 'enforce' } = {}) {}

  async captureAutomatic(memory: MemoryProvider, candidate: AutomaticMemoryCandidate): Promise<MemoryCaptureResult> {
    const id = candidateId(candidate)
    if (this.options.captureMode === 'shadow') {
      // Shadow mode evaluates only when source evidence is valid, then keeps
      // the legacy write path byte-for-byte independent of Jev's answer.
      if (candidate.evidence.ids.length && candidate.evidence.spans?.length === candidate.evidence.ids.length && candidate.evidence.revision && this.advisor) {
        const tainted = candidate.evidence.spans.some(span => span.provenance === 'untrusted')
        try {
          await this.advisor.judge({ ...candidate, provenance: candidate.provenance === 'untrusted' || tainted ? 'untrusted' : 'trusted' })
        } catch (error) {
          if (error instanceof MemoryDecisionControlError) throw error
        }
      }
      await memory.write(candidate.scope, candidate.key, candidate.content, candidate.links, candidate.temporal, { tainted: candidate.provenance === 'untrusted' || candidate.evidence.spans?.some(span => span.provenance === 'untrusted') === true, source: candidate.source }, candidate.claim)
      return { status: 'promoted', key: candidate.key, id }
    }
    if (!candidate.evidence.ids.length || new Set(candidate.evidence.ids).size !== candidate.evidence.ids.length || !candidate.evidence.revision || !candidate.evidence.spans?.length || candidate.evidence.spans.length !== candidate.evidence.ids.length || candidate.evidence.ids.some(id => !candidate.evidence.spans?.some(span => span.id === id)) || candidate.evidence.spans.some(span => !span.id || !candidate.evidence.ids.includes(span.id) || !span.text.trim() || span.text.length > 4_000)) return { status: 'rejected', key: candidate.key, id, reason: 'missing_or_invalid_evidence' }
    const tainted = candidate.evidence.spans.some(span => span.provenance === 'untrusted')
    const effectiveCandidate = { ...candidate, provenance: candidate.provenance === 'untrusted' || tainted ? 'untrusted' as const : 'trusted' as const }
    const existing = await memory.list(candidate.scope)
    if (existing.some(entry => evidenceMatches(entry, effectiveCandidate))) {
      return { status: 'rejected', key: candidate.key, id, reason: 'duplicate_evidence' }
    }
    if (!this.advisor) return { status: 'pending', key: candidate.key, id, reason: 'decision_unavailable' }
    let judgement: MemoryJudgement | undefined
    try {
      judgement = await this.advisor.judge(effectiveCandidate, { existing })
    } catch (error) {
      if (error instanceof MemoryDecisionControlError) throw error
      return { status: 'pending', key: candidate.key, id, reason: 'decision_failure' }
    }
    if (!judgement) return { status: 'pending', key: candidate.key, id, reason: 'decision_unavailable' }
    if (!judgement.support || !judgement.durable || !judgement.useful || judgement.duplicate || judgement.conflict) {
      return { status: 'rejected', key: candidate.key, id, reason: judgement.reason ?? 'policy_rejected' }
    }
    const claim = candidate.claim
      ? { ...candidate.claim, source_evidence: [...new Set([...(candidate.claim.source_evidence ?? []), ...candidate.evidence.ids])] }
      : undefined
    const record: MemoryRecord = {
      content: candidate.content,
      links: candidate.links,
      temporal: candidate.temporal,
      provenance: effectiveCandidate.provenance ?? 'trusted',
      source: candidate.source ?? candidate.evidence.spans.find(span => span.provenance === 'untrusted')?.source,
      claim,
      source_evidence: candidate.evidence.ids,
      source_revision: candidate.evidence.revision,
    }
    if (memory.writeRecord) await memory.writeRecord(candidate.scope, candidate.key, record)
    else await memory.write(candidate.scope, candidate.key, record.content, record.links, record.temporal, { tainted: record.provenance === 'untrusted', source: record.source }, record.claim)
    return { status: 'promoted', key: candidate.key, id }
  }

  async writeExplicit(memory: MemoryProvider, candidate: Omit<AutomaticMemoryCandidate, 'evidence'> & { evidence?: MemoryEvidence }): Promise<MemoryCaptureResult> {
    const id = candidateId({ ...candidate, evidence: candidate.evidence ?? { ids: [] } })
    const claim = candidate.claim && candidate.evidence
      ? { ...candidate.claim, source_evidence: [...new Set([...(candidate.claim.source_evidence ?? []), ...candidate.evidence.ids])] }
      : candidate.claim
    const existing = await memory.read(candidate.scope, candidate.key)
    const record: MemoryRecord = { content: candidate.content, links: candidate.links, temporal: candidate.temporal, provenance: candidate.provenance ?? 'trusted', source: candidate.source, claim, retention: { ...existing?.retention, state: 'active', explicit: true }, source_evidence: candidate.evidence?.ids, source_revision: candidate.evidence?.revision }
    if (memory.writeRecord) await memory.writeRecord(candidate.scope, candidate.key, record)
    else await memory.write(candidate.scope, candidate.key, record.content, record.links, record.temporal, { tainted: record.provenance === 'untrusted', source: record.source }, record.claim)
    return { status: 'explicit', key: candidate.key, id }
  }

  async recall(memory: MemoryProvider, scope: MemoryScope, query: RecallQuery): Promise<MemoryEntry[]> {
    const candidates = await memory.query(scope, query)
    return this.rankCandidates(query, candidates)
  }

  /**
   * Prompt recall keeps structural validity and scope ownership local, then
   * gives Jev only that bounded candidate set. The request text is used for
   * ranking, rather than lexical filtering, so imminent and pinned records
   * can still be preserved under the existing memory rules.
   */
  async recallForPrompt(memory: MemoryProvider, scope: MemoryScope, request: string, at = new Date()): Promise<MemoryEntry[]> {
    const candidates = await memory.query(scope, { at: at.toISOString(), limit: 32 })
    return this.rankCandidates({ at: at.toISOString(), text: request.slice(0, 1_000), limit: 32 }, candidates, true)
  }

  /** Render the bounded, task-relevant memory section used by initial prompts. */
  async buildPromptSection(memory: MemoryProvider, request: string, project = 'inbox', at = new Date()): Promise<string> {
    try {
      return await this.buildPromptSectionInner(memory, request, project, at)
    } catch (error) {
      if (error instanceof MemoryDecisionControlError) throw error
      return memory.buildSystemPromptSection()
    }
  }

  private async buildPromptSectionInner(memory: MemoryProvider, request: string, project = 'inbox', at = new Date()): Promise<string> {
    if (this.options.recallMode === 'shadow') {
      const scopes: MemoryScope[] = ['profile', 'user', ...(project === 'inbox' ? [] : ['project' as const])]
      await Promise.all(scopes.map(scope => this.recallForPrompt(memory, scope, request, at).catch(error => {
        if (error instanceof MemoryDecisionControlError) throw error
        return []
      })))
      return memory.buildSystemPromptSection()
    }

    const scopes: Array<{ scope: MemoryScope; label: string }> = [
      { scope: 'profile', label: 'shared' },
      { scope: 'user', label: 'yours' },
      ...(project === 'inbox' ? [] : [{ scope: 'project' as const, label: 'project' }]),
    ]
    const parts: string[] = []
    for (const { scope, label } of scopes) {
      const all = (await memory.list(scope)).filter(entry => entry.retention?.state !== 'archived')
      const structural = await this.recallForPrompt(memory, scope, request, at)
      const valid = all.filter(entry => isValidAt(entry.temporal, at))
      const imminent = imminentEntries(valid, at)
      const pinned = valid.filter(entry => entry.retention?.pinned)
      const byKey = new Map<string, MemoryEntry>()
      for (const entry of [...pinned, ...imminent, ...structural.filter(entry => !pinned.some(pin => pin.key === entry.key) && !imminent.some(item => item.key === entry.key))]) if (!byKey.has(entry.key)) byKey.set(entry.key, entry)
      const selected = [...byKey.values()].slice(0, 32)
      if (selected.length) parts.push(`## Memory (${label})\n${selected.map(entry => `- **${entry.key}**${entry.provenance === 'untrusted' ? ' [untrusted]' : ''}: ${entry.preview.replace(/\n/g, ' ')}`).join('\n')}`)
    }
    return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : ''
  }

  private async rankCandidates(query: RecallQuery, candidates: MemoryEntry[], select = false): Promise<MemoryEntry[]> {
    if (!this.advisor?.rank || candidates.length === 0) return candidates
    try {
      const ranked = await this.advisor.rank(query, candidates)
      if (!ranked) return candidates
      if (!ranked.length) return select ? [] : candidates
      const order = new Map(ranked.map((item, index) => [item.key, { index, score: item.score ?? 0 }]))
      const ordered = [...candidates].sort((a, b) => (order.get(a.key)?.index ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key)?.index ?? Number.MAX_SAFE_INTEGER) || (order.get(b.key)?.score ?? 0) - (order.get(a.key)?.score ?? 0))
      return select ? ordered.filter(entry => order.has(entry.key)) : ordered
    } catch (error) {
      if (error instanceof MemoryDecisionControlError) throw error
      return candidates
    }
  }

  async archive(memory: MemoryProvider, scope: MemoryScope, key: string, reason: string, sourceRevision?: string): Promise<{ status: 'archived' | 'skipped'; reason?: string }> {
    const current = await memory.read(scope, key)
    if (!current) return { status: 'skipped', reason: 'not_found' }
    if (sourceRevision !== undefined && current.source_revision !== undefined && current.source_revision !== sourceRevision) return { status: 'skipped', reason: 'stale_assessment' }
    if (current.retention?.pinned || current.retention?.explicit) return { status: 'skipped', reason: 'protected' }
    if (!memory.archive) return { status: 'skipped', reason: 'provider_unsupported' }
    await memory.archive(scope, key, { state: 'archived', reason, source_revision: sourceRevision, decided_at: new Date().toISOString() })
    return { status: 'archived' }
  }

  async retain(memory: MemoryProvider, scope: MemoryScope, candidates: MemoryEntry[]): Promise<string[]> {
    if (!this.advisor?.retain) return []
    const protectedCandidates = candidates.slice(0, 32).filter(entry => !entry.retention?.pinned && !entry.retention?.explicit)
    const assessed = new Map(protectedCandidates.map(entry => [entry.key, memoryFingerprint(entry)]))
    let nominated: string[] | undefined
    try {
      nominated = await this.advisor.retain(protectedCandidates)
    } catch (error) {
      if (error instanceof MemoryDecisionControlError) throw error
      return []
    }
    if (this.options.retentionMode === 'shadow') return []
    if (!nominated?.length || !memory.archive) return []
    const archived: string[] = []
    for (const key of nominated) {
      const current = await memory.read(scope, key)
      if (memoryFingerprint(current) !== assessed.get(key)) continue
      const result = await this.archive(memory, scope, key, 'semantic retention review', current?.source_revision)
      if (result.status === 'archived') archived.push(key)
    }
    return archived
  }

  /** Evaluate only structurally related claim pairs and persist unresolved results. */
  async detectSemanticConflicts(memory: MemoryProvider, scope: MemoryScope, store: MemoryConflictStore): Promise<MemoryConflict[]> {
    if (!this.advisor?.conflict) return []
    const entries = await memory.list(scope)
    const structural = detectConflicts(entries, store.owner, scope)
    const created: MemoryConflict[] = []
    for (const conflict of structural) {
      const a = entries.find(entry => entry.key === conflict.claim_a.key)
      const b = entries.find(entry => entry.key === conflict.claim_b.key)
      if (!a || !b) continue
      const judgement = await this.advisor.conflict(a, b)
      if (!judgement?.conflict) continue
      if (this.options.captureMode === 'shadow' || this.options.retentionMode === 'shadow') continue
      const already = store.list().some(existing => existing.scope === scope && existing.claim_a.key === a.key && existing.claim_b.key === b.key && existing.state === 'open')
      if (already) continue
      created.push(recordUnresolvedConflict(store, {
        user: store.owner, scope, claim_key: conflict.claim_key,
        claim_a: conflict.claim_a, claim_b: conflict.claim_b,
        dependent_missions: [], evidence: [...new Set([...(a.source_evidence ?? []), ...(b.source_evidence ?? [])])],
        rationale: judgement.rationale, candidate_revision: `${a.source_revision ?? ''}:${b.source_revision ?? ''}`,
      }))
    }
    return created
  }

  async restore(memory: MemoryProvider, scope: MemoryScope, key: string): Promise<void> {
    if (!memory.restore) throw new Error('memory provider does not support restore')
    await memory.restore(scope, key)
  }
}

export { candidateId }
