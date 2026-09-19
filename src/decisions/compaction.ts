import type { DecisionEvaluateOptions, DecisionOutcome, DecisionProvider, DecisionQuestion } from './types.js'

export interface CompactionSourceGroup {
  id: string
  sourceRevision: string
  start: number
  end: number
  messages: unknown[]
  containsToolPair: boolean
}

export interface CompactionDecisionAdvisor {
  /** Returns source-group IDs to preserve. It never returns generated text. */
  select(groups: readonly CompactionSourceGroup[], budget: { maxGroups: number; maxBytes: number }): Promise<string[] | undefined>
  /** Shadow assessment runs the same provider call but projection ignores selections. */
  mode?: 'shadow' | 'enforce'
}

export class CompactionDecisionControlError extends Error {
  constructor(readonly reason: string) { super(`compaction decision control: ${reason}`); this.name = 'CompactionDecisionControlError' }
}

function bounded(value: unknown, max: number): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? text.slice(0, max) : text
}

function answerValue(outcome: Extract<DecisionOutcome, { kind: 'success' }>, key: string): number {
  const answer = outcome.response.answers[key]
  return answer?.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : 0
}

export function createCompactionDecisionAdvisor(options: { provider: DecisionProvider; model: string; signal?: AbortSignal; evaluateOptions?: Omit<DecisionEvaluateOptions, 'signal'>; mode?: 'shadow' | 'enforce' }): CompactionDecisionAdvisor {
  return {
    mode: options.mode ?? 'enforce',
    async select(groups, budget) {
      const boundedGroups: Array<{ id: string; sourceRevision: string; start: number; end: number; containsToolPair: boolean; messages: unknown[] }> = []
      let bytes = 0
      for (const group of groups.slice(0, budget.maxGroups)) {
        const candidate = { id: group.id, sourceRevision: group.sourceRevision, start: group.start, end: group.end, containsToolPair: group.containsToolPair, messages: group.messages.map(message => bounded(message, 2_000)) }
        const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8')
        if (candidateBytes > budget.maxBytes || bytes + candidateBytes > budget.maxBytes) break
        boundedGroups.push(candidate)
        bytes += candidateBytes
      }
      const questions: Record<string, DecisionQuestion> = Object.fromEntries(boundedGroups.map(group => [group.id, { type: 'noul', instructions: 'Should this existing source group be preserved because it contains an unresolved user commitment or useful verified evidence? Select only from supplied source groups; never summarize or invent content.' }])) as Record<string, DecisionQuestion>
      const state = { groups: boundedGroups, budget }
      const outcome = await options.provider.evaluate({ model: options.model, state: state as any, questions }, { ...options.evaluateOptions, signal: options.signal })
      if (outcome.kind === 'control') throw new CompactionDecisionControlError(outcome.reason)
      if (outcome.kind !== 'success') return undefined
      return boundedGroups.filter(group => answerValue(outcome, group.id) >= 0.5).map(group => group.id)
    },
  }
}
