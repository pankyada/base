import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson, readJson, RevisionConflictError, updateJsonRecord } from '../src/shared/atomic-json.js'
import { createMission, evidenceRef, evaluateCriterion, finalizeMission, completeHumanCriterion, MissionStore } from '../src/missions/index.js'
import { SessionRuntime, SessionRuntimeRegistry } from '../src/server/session-runtime.js'
import { branch, exportJournal, hashArguments, importJournal, matchFixture, newJournal, playback, recordEffect, recordEvent } from '../src/replay/index.js'
import { compare, createDataset, promotionGate, runEvaluation, summarize } from '../src/evaluation/index.js'
import { detectConflicts, resolveConflict } from '../src/memory/conflicts.js'
import { applyFileProposal, applyMemoryProposal, fileWritePreview, memoryWritePreview, unsupportedProposal } from '../src/rehearsal/index.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { createSession } from '../src/session/store.js'
import { addVersion, createRecipe, refresh } from '../src/artifacts/index.js'
import { ChallengeDesk } from '../src/agents/challenges.js'
import { applyEvaluation, proposeCorrection, promoteCorrection, rollbackCorrection } from '../src/improver/corrections.js'

describe('verifiable agent work foundations', () => {
  it('atomic write retains old value when rename hook fails and enforces revisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-atomic-')); const path = join(dir, 'record.json')
    atomicWriteJson(path, { revision: 1, value: 'old' })
    expect(() => atomicWriteJson(path, { revision: 2, value: 'new' }, { beforeRename: () => { throw new Error('simulated interruption') } })).toThrow('simulated interruption')
    expect(readJson(path)).toEqual({ revision: 1, value: 'old' })
    expect(() => updateJsonRecord(path, 0, current => ({ revision: (current?.revision ?? 0) + 1, value: 'x' }))).toThrow(RevisionConflictError)
  })

  it('rejects forged evidence and keeps human criteria explicit', () => {
    const mission = createMission({ user: 'alice', profile: 'p', project: 'inbox', outcome: 'done', constraints: [], criteria: [{ id: 'cmd', description: 'command succeeds', kind: 'tool_result_match', expected: 'ok' }, { id: 'human', description: 'operator confirms', kind: 'human' }] })
    const good = evidenceRef({ kind: 'tool_result', source: { user: 'alice', session: mission.session_id }, content: 'ok' })
    const checked = evaluateCriterion(mission.criteria[0], [good]); expect(checked.state).toBe('verified')
    expect(() => finalizeMission(mission, 'finished', [{ ...good, source: { user: 'bob' } }])).toThrow('user')
    expect(evaluateCriterion(mission.criteria[1], [good]).state).toBe('needs_human')
    const completed = completeHumanCriterion(mission, 'human', 'alice', mission.revision); expect(completed.criteria[1].state).toBe('verified')
  })

  it('keeps failed tool receipts failed and validates structured artifact schemas', () => {
    const failed = createMission({ user: 'alice', profile: 'p', project: 'inbox', outcome: 'done', constraints: [], criteria: [{ id: 'cmd', description: 'command succeeds', kind: 'tool_result_match', expected: 'ok' }] })
    const failedEvidence = evidenceRef({ kind: 'tool_result', source: { user: 'alice', session: failed.session_id }, content: 'ok despite an executor error', ok: false })
    expect(evaluateCriterion(failed.criteria[0], [failedEvidence]).state).toBe('failed')

    const schema = createMission({ user: 'alice', profile: 'p', project: 'inbox', outcome: 'artifact', constraints: [], criteria: [{ id: 'shape', description: 'has numeric value', kind: 'artifact_schema', expected: { type: 'object', required: ['value'], properties: { value: { type: 'number' } } } }] })
    const good = evidenceRef({ kind: 'artifact', source: { user: 'alice', session: schema.session_id, path: '/tmp/result.json' }, content: { value: 2 } })
    const bad = evidenceRef({ kind: 'artifact', source: { user: 'alice', session: schema.session_id, path: '/tmp/result.json' }, content: { value: 'two' } })
    expect(evaluateCriterion(schema.criteria[0], [good]).state).toBe('verified')
    expect(evaluateCriterion(schema.criteria[0], [bad]).state).toBe('failed')
  })

  it('runtime emits ordered events, snapshots gaps, rejects stale controller and deduplicates response', () => {
    const runtime = new SessionRuntime('s', 'alice', 2, 1000); const claim = runtime.claim('browser'); let calls = 0
    runtime.respond('r', 'browser', claim.lease, () => { calls++; return 'ok' }); expect(runtime.respond('r', 'browser', claim.lease, () => { calls++; return 'bad' })).toBe('ok'); expect(calls).toBe(1)
    runtime.emit('one', {}); runtime.emit('two', {}); runtime.emit('three', {}); expect(runtime.subscribe(0).gap).toBe(false); expect(runtime.subscribe(1).gap).toBe(true); expect(() => runtime.respond('x', 'old', claim.lease, () => 'x')).toThrow('stale')
  })

  it('returns detached recovery state and explicitly resyncs future cursors', async () => {
    const runtime = new SessionRuntime('s', 'alice', 4)
    const claim = runtime.claim('browser')
    const payload = { nested: { value: 'private' } }
    runtime.emit('tool_prompt', { id: 'ask', ...payload })
    const snapshot = runtime.state
    const prompt = snapshot.events.find(event => event.type === 'tool_prompt')!
    ;(prompt.payload as any).nested.value = 'changed'
    snapshot.actionable_ids.push('forged')
    expect((runtime.state.events.find(event => event.type === 'tool_prompt')!.payload as any).nested.value).toBe('private')
    expect(runtime.state.actionable_ids).toEqual(['ask'])
    expect(runtime.subscribe(99).gap).toBe(true)
    let calls = 0
    let release!: () => void
    const first = runtime.respond('async', 'browser', claim.lease, () => new Promise(resolve => { calls++; release = () => resolve('ok') }))
    const second = runtime.respond('async', 'browser', claim.lease, () => { calls++; return Promise.resolve('bad') })
    expect(first).toBe(second)
    expect(calls).toBe(1)
    release()
    await expect(first).resolves.toBe('ok')
  })

  it('two attached clients share journal and transfer control without duplicate response', () => {
    const first = new SessionRuntime('shared', 'alice', 8); const second = first; const claim = first.claim('tui'); const observer = second.subscribe(0); expect(observer.snapshot.session_id).toBe('shared'); first.emit('tool_end', { id: '1' }); expect(second.subscribe(observer.snapshot.last_seq).events).toHaveLength(1); const moved = first.transfer('tui', claim.lease, 'browser'); expect(moved.lease).not.toBe(claim.lease); expect(() => first.respond('approval', 'tui', claim.lease, () => true)).toThrow('stale'); expect(first.respond('approval', 'browser', moved.lease, () => true)).toBe(true)
  })

  it('local two-client reconnect catches up, restricts stale control, and expires disconnect lease', () => {
    const registry = new SessionRuntimeRegistry(8, 5)
    const primary = registry.getOrCreate('local-session', 'alice')
    const observer = registry.get('local-session', 'alice')!
    const claim = primary.claim('tui', undefined, 5)
    const initial = observer.subscribe(0)
    primary.emit('tool_prompt', { id: 'approval-1' })
    expect(observer.subscribe(initial.snapshot.last_seq).events?.map(event => event.type)).toEqual(['tool_prompt'])
    expect(() => primary.respond('approval-1', 'browser', claim.lease, () => true)).toThrow('stale')
    expect(registry.cleanup(Date.now() + 10)).toBe(1)
    const afterDisconnect = primary.state
    expect(afterDisconnect.controller).toBeUndefined()
    const reconnect = primary.claim('browser', undefined, 1000)
    expect(reconnect.lease).not.toBe(claim.lease)
  })

  it('restores terminal runtime state and fails interrupted work after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-runtime-'))
    const first = new SessionRuntimeRegistry(8, 1000, root)
    const runtime = first.getOrCreate('restart-session', 'alice')
    runtime.emit('tool_start', { id: 'tool-1' })
    const second = new SessionRuntimeRegistry(8, 1000, root)
    const restored = second.get('restart-session', 'alice')!
    expect(restored.state.status).toBe('failed')
    expect(restored.state.controller).toBeUndefined()
    expect(restored.state.events.some(event => event.type === 'runtime_restarted')).toBe(true)
    const terminal = first.getOrCreate('done-session', 'alice')
    terminal.setStatus('completed')
    const restoredTerminal = new SessionRuntimeRegistry(8, 1000, root).get('done-session', 'alice')!
    expect(restoredTerminal.state.status).toBe('completed')
  })

  it('plays journal without executing effects and branches with lineage', async () => {
    const journal = newJournal({ user: 'alice', session_id: 's', profile: 'p', config_fingerprint: 'cfg', mode: 'fixture' }); recordEvent(journal, 'result', 'done'); const effect = recordEffect(journal, { tool: 'Write', argument_hash: hashArguments({ path: 'a' }), state: 'completed' }); journal.completed_checkpoints.push('cp')
    const events: unknown[] = []; await playback(journal, e => { events.push(e) }); expect(events).toHaveLength(1); expect(matchFixture(journal, 'Write', { path: 'a' })).toEqual({ ok: true, receipt: effect }); expect(branch(journal, 'cp').parent_run_id).toBe(journal.id); expect(importJournal(exportJournal(journal)).warnings.length).toBeGreaterThan(0)
  })

  it('evaluates same fixture dataset and blocks incomplete promotion', async () => {
    const dataset = createDataset('d', [{ input: 'x', fixture_refs: [], expected: {}, split: 'development' }, { input: 'y', fixture_refs: [], expected: {}, split: 'held_out' }]); const run = await runEvaluation(dataset, { profile: 'p', configFingerprint: 'c', execute: async test => ({ correct: test.input === 'x', tool_errors: 0, human_intervention: false }) }); const summary = summarize(run); expect(summary.sample_count).toBe(2); expect(compare(summary, summary).accuracy_delta).toBe(0); expect(promotionGate(summary, { ...summary, completed_count: 0 }, { minSamples: 1, maxRegression: 0 }).pass).toBe(false)
  })

  it('detects temporal claim conflict and preserves provenance on resolution', () => {
    const entries: any[] = [{ key: 'a', preview: 'x', claim: { entity: 'user', predicate: 'city', normalized_value: 'Sydney' }, temporal: { valid_from: '2026-01-01T00:00:00Z', valid_until: '2026-12-31T00:00:00Z' } }, { key: 'b', preview: 'x', claim: { entity: 'user', predicate: 'city', normalized_value: 'Melbourne' }, temporal: { valid_from: '2026-02-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z' } }]; const conflicts = detectConflicts(entries, 'alice', 'user'); expect(conflicts).toHaveLength(1); const resolved = resolveConflict(conflicts[0], { user: 'alice', revision: 1, preserveAmbiguity: true }); expect(resolved.state).toBe('ambiguous'); expect(resolved.claim_a.value).toBe('Sydney')
  })

  it('previews without mutation, rejects stale precondition, and supports apply', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-rehearsal-')); const path = join(dir, 'a.txt'); writeFileSync(path, 'old'); const proposal = fileWritePreview('alice', path, 'new', 'cfg'); expect(readFileSync(path, 'utf8')).toBe('old'); writeFileSync(path, 'changed'); expect(() => applyFileProposal(proposal, { user: 'alice', approve: true, expectedRevision: 1 })).toThrow('precondition'); expect(unsupportedProposal('alice', 'Bash', {}, 'cfg').effect).toBe('unsupported')
  })

  it('applies approved memory rehearsal only when precondition still matches', async () => {
    const provider = new FsMemoryProvider(mkdtempSync(join(tmpdir(), 'harness-memory-rehearsal-')), createSession('fixture', 'alice'))
    const proposal = memoryWritePreview('alice', 'user', 'fact', 'new', null, 'cfg')
    await expect(applyMemoryProposal(proposal, { user: 'alice', approve: true, expectedRevision: 1, memory: provider })).resolves.toMatchObject({ proposal: { state: 'applied' }, receipt: { after_hash: expect.any(String) } })
    await expect(provider.read('user', 'fact')).resolves.toMatchObject({ content: 'new' })
  })

  it('refreshes artifacts and retains last-good payload on failure', async () => {
    let calls = 0; const recipe = addVersion(createRecipe({ user: 'alice', profile: 'p', generating_tool: 'fixture', parameters: {}, source_dependencies: ['src'], provenance: {}, refresh_policy: { enabled: true, confirm_new_effects: true } }), { value: 1 }); const same = await refresh(recipe, { probe: async () => ({ changed: false }), generate: async () => { calls++; return { value: 2 } } }); expect(calls).toBe(0); expect(same.last_good?.payload).toEqual({ value: 1 }); const stale = await refresh(recipe, { probe: async () => ({ changed: true }), generate: async () => { throw new Error('source deleted') } }); expect(stale.freshness).toBe('stale'); expect(stale.last_good?.payload).toEqual({ value: 1 })
  })

  it('caps challenge rounds and requires evidence; correction promotion is explicit and rollbackable', () => {
    const desk = new ChallengeDesk(1, 1); const challenge = desk.open({ missionId: 'm', challenger: 'worker', question: 'prove it' }); expect(() => desk.answer(challenge.id, { by: 'root' })).toThrow('evidence'); const answered = desk.answer(challenge.id, { by: 'root', unresolved: true }); expect(answered.state).toBe('unresolved'); const proposal = proposeCorrection({ scope: 'skill/x', sourceMissionId: 'm', rationale: 'fix', before: 'old', after: 'new', regressionCaseIds: ['case'] }); const passed = applyEvaluation(proposal, { passed: true, complete: true }); const promoted = promoteCorrection(passed, 'old'); expect(rollbackCorrection(promoted, 'new').content).toBe('old')
  })

  it('blocks promotion after failed evaluation, then permits explicit promote and rollback after pass', () => {
    const proposal = proposeCorrection({ scope: 'skill/x', sourceMissionId: 'm', rationale: 'fix', before: 'old', after: 'new', regressionCaseIds: ['case'] })
    const failed = applyEvaluation(proposal, { passed: false, complete: true })
    expect(failed.status).toBe('failed')
    expect(() => promoteCorrection(failed, 'old')).toThrow('only a passed correction can be promoted')
    const passed = applyEvaluation(failed, { passed: true, complete: true })
    const promoted = promoteCorrection(passed, 'old')
    expect(promoted.status).toBe('promoted')
    const rolledBack = rollbackCorrection(promoted, 'new')
    expect(rolledBack.proposal.status).toBe('rolled_back')
    expect(rolledBack.content).toBe('old')
  })
})
