import { describe, expect, it, vi } from 'vitest'
import { branch, hashArguments, importJournal, markCheckpoint, matchFixture, newJournal, playback, recordEffect, recordEvent, reconcileEffect } from '../src/replay/index.js'
import { captureCaseFromMission, createDataset, promotionGate, runEvaluation, summarize } from '../src/evaluation/index.js'
import { createMission, finalizeMission, evidenceRef } from '../src/missions/index.js'

describe('R5 replay and branches', () => {
  it('plays recorded events without touching an executor and copies only checkpoint context', async () => {
    const journal = newJournal({ user: 'alice', session_id: 's', profile: 'p', config_fingerprint: 'cfg', mode: 'fixture' }); const executor = vi.fn(); recordEvent(journal, 'result', { text: 'safe', api_key: 'secret' }); markCheckpoint(journal, 'safe'); recordEvent(journal, 'result', 'after'); const effect = recordEffect(journal, { tool: 'Write', argument_hash: hashArguments({ path: 'a' }), state: 'completed' });
    const emitted: unknown[] = []; await playback(journal, event => { emitted.push(event) }); expect(executor).not.toHaveBeenCalled(); expect(JSON.stringify(emitted)).not.toContain('secret'); const child = branch(journal, 'safe', { profile: 'candidate' }); expect(child.parent_run_id).toBe(journal.id); expect(child.profile).toBe('candidate'); expect(child.events).toHaveLength(1); expect(journal.events).toHaveLength(2); expect(effect).toBeDefined()
  })
  it('closes fixture mismatch and unknown effect until explicit reconciliation', () => {
    const journal = newJournal({ user: 'a', session_id: 's', profile: 'p', config_fingerprint: 'c', mode: 'fixture' }); const unknown = recordEffect(journal, { tool: 'Write', argument_hash: hashArguments({ path: 'a' }), state: 'unknown' }); expect(matchFixture(journal, 'Write', { path: 'wrong' }).ok).toBe(false); expect(matchFixture(journal, 'Write', { path: 'a' }).ok).toBe(false); reconcileEffect(journal, unknown.id, 'reconciled'); expect(matchFixture(journal, 'Write', { path: 'a' }).ok).toBe(true)
  })
  it('rejects malformed and oversized imported journals', () => { expect(() => importJournal({ version: 2 })).toThrow('unsupported'); expect(() => importJournal({ version: 1, id: 'x', user: 'a', session_id: 's', events: [], effects: [], completed_checkpoints: [], mode: 'fixture', profile: 'p', config_fingerprint: 'c' }, { maxBytes: 10 })).toThrow('size') })
})

describe('R6 evaluation lab', () => {
  it('stops on cancellation, records unavailable cases, and blocks incomplete promotion', async () => {
    const dataset = createDataset('fixture', [{ input: 'a', fixture_refs: [], expected: {}, split: 'development' }, { input: 'b', fixture_refs: [], expected: {}, split: 'held_out' }]); const controller = new AbortController(); let calls = 0; const run = await runEvaluation(dataset, { profile: 'p', configFingerprint: 'v1', signal: controller.signal, execute: async test => { calls++; controller.abort(); return { correct: test.input === 'a', tool_errors: 0, human_intervention: false } } }); const summary = summarize(run); expect(calls).toBe(1); expect(run.status).toBe('cancelled'); expect(summary.status).toBe('cancelled'); expect(promotionGate(summary, { ...summary, status: 'completed', completed_count: 0 }, { minSamples: 1, maxRegression: 0 }).pass).toBe(false)
  })
  it('captures mission receipt as an explicit dataset case and enforces a spend ceiling', async () => {
    const mission = createMission({ user: 'a', profile: 'p', project: 'inbox', outcome: 'done', constraints: [], criteria: [{ id: 'ok', description: 'ok', kind: 'tool_result_match', expected: 'ok' }] }); const receipt = finalizeMission(mission, 'finished', [evidenceRef({ kind: 'tool_result', source: { user: 'a', session: mission.session_id }, content: 'ok' })]); const captured = captureCaseFromMission({ mission, receipt, input: 'do it' }); expect(captured.source_mission_id).toBe(mission.id); const dataset = createDataset('budget', [captured, { input: 'second', fixture_refs: [], expected: {}, split: 'held_out' }]); let calls = 0; const run = await runEvaluation(dataset, { profile: 'p', configFingerprint: 'v1', budgetUsd: 0.01, estimateCost: () => 0.02, execute: async () => { calls++; return { correct: true, cost_usd: 0.02, tool_errors: 0, human_intervention: false } } }); expect(calls).toBe(0); expect(run.status).toBe('budget_exceeded')
  })
})
