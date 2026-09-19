import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { GraphMemoryProvider } from '../src/memory/graph-memory.js'
import { createSession } from '../src/session/store.js'
import { MemoryCaptureService, MemoryDecisionControlError, createMemoryDecisionAdvisor } from '../src/decisions/memory.js'
import type { MemoryProvider } from '../src/memory/interface.js'
import { memoryRestoreTool } from '../src/tools/builtin/memory-restore.js'
import { memoryListTool } from '../src/tools/builtin/memory-list.js'
import { memoryReviewTool } from '../src/tools/builtin/memory-review.js'
import { effectFor } from '../src/tools/effects.js'
import { memoryWriteTool } from '../src/tools/builtin/memory-write.js'
import { refreshMemoryPrompt, restoreBaselineMemoryPrompt, MEMORY_PROMPT_END, MEMORY_PROMPT_START } from '../src/context/system-prompt.js'

function providers(): MemoryProvider[] {
  const artifact = mkdtempSync(join(tmpdir(), 'harness-jev-memory-'))
  const session = createSession('test', `jev-memory-${Math.random().toString(36).slice(2)}`)
  return [new FsMemoryProvider(artifact, session), new GraphMemoryProvider(artifact, session)]
}

describe.each(providers())('evidence-aware memory (%s)', memory => {
  it('does not promote missing, uncertain, or unsupported automatic evidence', async () => {
    const rejected = new MemoryCaptureService({ judge: async () => ({ support: false, durable: true, useful: true, duplicate: false, conflict: false }) })
    await expect(rejected.captureAutomatic(memory, { scope: 'user', key: 'claim', content: 'unsupported', evidence: { ids: [] } })).resolves.toMatchObject({ status: 'rejected', reason: 'missing_or_invalid_evidence' })
    await expect(rejected.captureAutomatic(memory, { scope: 'user', key: 'claim', content: 'unsupported', evidence: { ids: ['turn:1'], spans: [{ id: 'turn:1', text: 'source text' }], revision: 'r1' } })).resolves.toMatchObject({ status: 'rejected' })
    expect(await memory.read('user', 'claim')).toBeNull()
  })

  it('promotes supported evidence with source identity and survives reload', async () => {
    const capture = new MemoryCaptureService({ judge: async () => ({ support: true, durable: true, useful: true, duplicate: false, conflict: false }) })
    await expect(capture.captureAutomatic(memory, { scope: 'user', key: 'preference', content: 'Use TypeScript', evidence: { ids: ['turn:2'], spans: [{ id: 'turn:2', text: 'User says use TypeScript', provenance: 'untrusted', source: 'mcp:notes' }], revision: 'session:1' }, provenance: 'untrusted', source: 'mcp:notes' })).resolves.toMatchObject({ status: 'promoted' })
    expect(await memory.read('user', 'preference')).toMatchObject({ content: 'Use TypeScript', provenance: 'untrusted', source: 'mcp:notes', source_evidence: ['turn:2'], source_revision: 'session:1' })
  })

  it('inherits taint from source spans and never launders it through promotion', async () => {
    const capture = new MemoryCaptureService({ judge: async candidate => ({ support: candidate.provenance === 'untrusted', durable: true, useful: true, duplicate: false, conflict: false }) })
    await expect(capture.captureAutomatic(memory, { scope: 'user', key: 'tainted', content: 'Copied claim', provenance: 'trusted', evidence: { ids: ['turn:tainted'], spans: [{ id: 'turn:tainted', text: 'Untrusted source', provenance: 'untrusted', source: 'mcp:feed' }], revision: 'r1' } })).resolves.toMatchObject({ status: 'promoted' })
    expect(await memory.read('user', 'tainted')).toMatchObject({ provenance: 'untrusted', source: 'mcp:feed' })
  })

  it('always writes an explicit user request when the advisor is unavailable', async () => {
    const capture = new MemoryCaptureService()
    await expect(capture.writeExplicit(memory, { scope: 'user', key: 'explicit', content: 'Keep this', provenance: 'trusted' })).resolves.toMatchObject({ status: 'explicit' })
    expect((await memory.read('user', 'explicit'))?.content).toBe('Keep this')
    expect((await memory.read('user', 'explicit'))?.retention).toMatchObject({ state: 'active', explicit: true })
    await expect(capture.archive(memory, 'user', 'explicit', 'low salience')).resolves.toMatchObject({ status: 'skipped', reason: 'protected' })
  })

  it('passes source spans to the mounted decision provider and propagates control outcomes', async () => {
    let seen: any
    const advisor = createMemoryDecisionAdvisor({ model: 'jev-test', provider: { evaluate: async request => {
      seen = request
      return { kind: 'success', response: { model: 'jev-test', answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: 'noul', noul: key === 'duplicate' || key === 'conflict' ? 0 : 1 }])) as any, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
    } } })
    const capture = new MemoryCaptureService(advisor)
    const mounted = await capture.captureAutomatic(memory, { scope: 'user', key: 'mounted', content: 'A supported fact', evidence: { ids: ['source:1'], spans: [{ id: 'source:1', text: 'The exact source sentence' }], revision: 'rev:1' } })
    expect(mounted).toMatchObject({ status: 'promoted' })
    expect(JSON.stringify(seen.state)).toContain('The exact source sentence')

    const controlAdvisor = createMemoryDecisionAdvisor({ model: 'jev-test', provider: { evaluate: async () => ({ kind: 'control', reason: 'cancelled' }) } })
    await expect(new MemoryCaptureService(controlAdvisor).captureAutomatic(memory, { scope: 'user', key: 'cancelled', content: 'fact', evidence: { ids: ['source:2'], spans: [{ id: 'source:2', text: 'source' }], revision: 'rev:1' } })).rejects.toBeInstanceOf(MemoryDecisionControlError)
  })

  it('archives reversibly while preserving full record metadata', async () => {
    await memory.write('user', 'old', 'retain all', undefined, undefined, { tainted: true, source: 'feed' }, { entity: 'x', predicate: 'status', normalized_value: 'old', source_evidence: ['source:1'] })
    const capture = new MemoryCaptureService()
    await expect(capture.archive(memory, 'user', 'old', 'low salience', 'rev-1')).resolves.toEqual({ status: 'archived' })
    expect(await memory.query('user', { text: 'retain' })).toEqual([])
    expect(await memory.read('user', 'old')).toMatchObject({ content: 'retain all', provenance: 'untrusted', source: 'feed', claim: { normalized_value: 'old' }, retention: { state: 'archived', reason: 'low salience', source_revision: 'rev-1' } })
    await capture.restore(memory, 'user', 'old')
    expect((await memory.query('user', { text: 'retain' })).map(entry => entry.key)).toEqual(['old'])
  })

  it('restores archive or review state with a full preimage undo record', async () => {
    await memory.write('user', 'review-me', 'review content', undefined, undefined, { tainted: true, source: 'feed' })
    await memory.archive?.('user', 'review-me', { state: 'review', reason: 'needs review' })
    const result: any = await memoryRestoreTool.execute({ scope: 'user', key: 'review-me' }, { memory, session: { project: 'inbox' } } as any)
    expect(result.content).toContain('Memory restored')
    expect(result.undo.kind).toBe('memory_restore')
    expect(result.undo.payload.before).toMatchObject({ content: 'review content', provenance: 'untrusted', retention: { state: 'review', reason: 'needs review' } })
    expect((await memory.read('user', 'review-me'))?.retention?.state).toBe('active')
  })

  it('ranks only structurally retrieved candidates and falls back on advisor failure', async () => {
    await memory.write('user', 'a', 'same topic')
    await memory.write('user', 'b', 'same topic')
    const capture = new MemoryCaptureService({ judge: async () => ({ support: true, durable: true, useful: true, duplicate: false, conflict: false }), rank: async () => [{ key: 'b' }] })
    expect((await capture.recall(memory, 'user', { text: 'topic' })).map(entry => entry.key)).toEqual(['b', 'a'])
    const fallback = new MemoryCaptureService({ judge: async () => ({ support: true, durable: true, useful: true, duplicate: false, conflict: false }), rank: async () => { throw new Error('offline') } })
    expect((await fallback.recall(memory, 'user', { text: 'topic' })).map(entry => entry.key)).toEqual(['a', 'b'])
  })

  it('uses bounded structural candidates for prompt recall and preserves shadow parity', async () => {
    await memory.write('user', 'target', 'task relevant memory')
    await memory.write('user', 'other', 'unrelated memory')
    const rank = vi.fn().mockResolvedValue([{ key: 'target', score: 1 }])
    const enforce = new MemoryCaptureService({
      judge: async () => ({ support: true, durable: true, useful: true, duplicate: false, conflict: false }),
      rank,
    })
    const selected = await enforce.buildPromptSection(memory, 'task relevant', 'inbox')
    expect(selected).toContain('target')
    expect(selected).not.toContain('other')
    expect(rank).toHaveBeenCalledWith(expect.objectContaining({ text: 'task relevant' }), expect.arrayContaining([expect.objectContaining({ key: 'target' }), expect.objectContaining({ key: 'other' })]))

    const baseline = await memory.buildSystemPromptSection()
    const shadow = new MemoryCaptureService({
      judge: async () => ({ support: true, durable: true, useful: true, duplicate: false, conflict: false }),
      rank,
    }, { recallMode: 'shadow' })
    await expect(shadow.buildPromptSection(memory, 'task relevant', 'inbox')).resolves.toBe(baseline)
  })

  it('evaluates capture and retention in shadow without changing baseline writes', async () => {
    const judge = vi.fn().mockResolvedValue({ support: false, durable: false, useful: false, duplicate: false, conflict: false })
    const shadowCapture = new MemoryCaptureService({ judge }, { captureMode: 'shadow' })
    await shadowCapture.captureAutomatic(memory, {
      scope: 'user', key: 'shadow-fact', content: 'legacy write',
      evidence: { ids: ['source:shadow'], spans: [{ id: 'source:shadow', text: 'source' }], revision: 'r1' },
    })
    expect(judge).toHaveBeenCalledOnce()
    expect(await memory.read('user', 'shadow-fact')).toMatchObject({ content: 'legacy write' })

    await memory.write('user', 'keep', 'keep this')
    const retain = vi.fn().mockResolvedValue(['keep'])
    const shadowRetention = new MemoryCaptureService({ judge: async () => undefined, retain }, { retentionMode: 'shadow' })
    await expect(shadowRetention.retain(memory, 'user', await memory.list('user'))).resolves.toEqual([])
    expect(retain).toHaveBeenCalledOnce()
    expect((await memory.read('user', 'keep'))?.retention).toBeUndefined()
  })

  it('does not archive a record changed after retention assessment', async () => {
    await memory.write('user', 'stale', 'before')
    const retain = vi.fn().mockImplementation(async () => {
      await memory.write('user', 'stale', 'after')
      return ['stale']
    })
    const capture = new MemoryCaptureService({ judge: async () => undefined, retain })
    await expect(capture.retain(memory, 'user', await memory.list('user'))).resolves.toEqual([])
    expect((await memory.read('user', 'stale'))?.content).toBe('after')
  })

  it('refreshes only the dynamic memory component for follow-up and resume queries', async () => {
    await memory.write('user', 'alpha', 'alpha memory')
    await memory.write('user', 'beta', 'beta memory')
    const advisor = {
      rank: vi.fn(async (query: any) => [{ key: query.text.includes('beta') ? 'beta' : 'alpha', score: 1 }]),
      judge: async () => ({ support: true, durable: true, useful: true, duplicate: false, conflict: false }),
    }
    const recall = new MemoryCaptureService(advisor)
    const session: any = { project: 'inbox', messages: [{ role: 'system', content: `STATIC${MEMORY_PROMPT_START}old${MEMORY_PROMPT_END}` }] }
    await refreshMemoryPrompt({ session, memory, memoryRecall: recall, query: 'alpha' })
    expect(session.messages[0].content).toContain('alpha')
    expect(session.messages[0].content).not.toContain('beta')
    await refreshMemoryPrompt({ session, memory, memoryRecall: recall, query: 'beta' })
    expect(session.messages[0].content).toMatch(/^STATIC/)
    expect(session.messages[0].content).toContain('beta')
    expect(session.messages[0].content).not.toContain('alpha')
    await restoreBaselineMemoryPrompt({ session, memory: { buildSystemPromptSection: async () => '\nBASELINE MEMORY' } as any })
    expect(session.messages[0].content).toBe('STATIC\nBASELINE MEMORY')
  })

  it('keeps listing read-only and routes retention mutation through write-classified review', async () => {
    const entries = [{ key: 'candidate', preview: 'candidate', content: 'candidate' }]
    const retain = vi.fn().mockResolvedValue(['candidate'])
    const ctx: any = {
      memory: { list: vi.fn().mockResolvedValue(entries) },
      memoryRetention: { retain },
      session: { project: 'test' },
    }

    await memoryListTool.execute({ scope: 'user' }, ctx)
    expect(retain).not.toHaveBeenCalled()
    expect(effectFor('MemoryList')).toBe('read')

    await expect(memoryReviewTool.execute({ scope: 'user' }, ctx)).resolves.toMatchObject({ content: expect.stringContaining('candidate') })
    expect(retain).toHaveBeenCalledWith(ctx.memory, 'user', entries)
    expect(effectFor('MemoryReview')).toBe('write')
  })

  it('returns the completed write receipt when post-write conflict inspection is unavailable', async () => {
    const capture = new MemoryCaptureService()
    vi.spyOn(capture, 'detectSemanticConflicts').mockRejectedValue(new Error('conflict service offline'))
    const events = { onNotice: vi.fn() }
    const result: any = await memoryWriteTool.execute({ scope: 'user', key: 'receipt', content: 'durable fact', claim: { entity: 'user', predicate: 'status' } }, {
      memory,
      memoryCapture: capture,
      memoryConflicts: {} as any,
      session: { project: 'test' },
      events,
    } as any)
    expect(result.content).toContain('Memory written: user/receipt')
    expect(result.undo).toMatchObject({ kind: 'memory_restore', payload: { key: 'receipt', before: null } })
    expect(events.onNotice).toHaveBeenCalledWith('warn', 'memory conflict inspection unavailable', 'conflict service offline')
  })
})
