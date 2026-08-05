import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { GraphMemoryProvider } from '../src/memory/graph-memory.js'
import { createSession } from '../src/session/store.js'
import { recallTool } from '../src/tools/builtin/recall.js'

const AT = '2026-08-15T12:00:00+05:30'

function providers() {
  const artifactDir = mkdtempSync(join(tmpdir(), 'harness-temporal-'))
  const session = createSession('test', `temporal-${Math.random().toString(36).slice(2)}`)
  return [
    new FsMemoryProvider(artifactDir, session),
    new GraphMemoryProvider(artifactDir, session),
  ]
}

describe.each(providers())('%s temporal memory', provider => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T06:30:00.000Z'))
  })

  afterEach(() => vi.useRealTimers())

  it('keeps old-format entries eternally valid', async () => {
    await provider.write('user', 'preference', 'Prefers TypeScript')
    const found = await provider.query('user', { at: AT })
    expect(found).toEqual([expect.objectContaining({ key: 'preference', content: 'Prefers TypeScript' })])
  })

  it('filters expired facts and returns future facts in a window', async () => {
    await provider.write('user', 'expired', 'Old flight', undefined, { valid_until: '2026-08-01T00:00:00+05:30' })
    await provider.write('user', 'future', 'New flight', undefined, { valid_from: '2026-08-20T00:00:00+05:30', entity: 'travel/delhi' })

    expect((await provider.query('user', { at: AT })).map(entry => entry.key)).not.toContain('expired')
    expect((await provider.query('user', { window: 'next 7d', at: AT, entity: 'travel/' })).map(entry => entry.key)).toEqual(['future'])
  })

  it('keeps expired facts out of the system prefix and pins imminent facts', async () => {
    await provider.write('user', 'expired', 'Old flight', undefined, { valid_until: '2020-01-01T00:00:00+00:00' })
    await provider.write('user', 'tomorrow', 'Pack passport', undefined, { valid_from: new Date(Date.now() + 60 * 60 * 1000).toISOString() })

    const section = await provider.buildSystemPromptSection()
    expect(section).not.toContain('Old flight')
    expect(section).toContain('## Memory (imminent)')
    expect(section).toContain('Pack passport')
  })

  it('collapses superseded current facts but keeps history recallable', async () => {
    await provider.write('user', 'budget-v1', 'Budget 40k', undefined, {
      entity: 'budget', valid_from: '2026-01-01T00:00:00+05:30', valid_until: '2026-12-31T23:59:59+05:30',
    })
    await provider.write('user', 'budget-v2', 'Budget 50k', undefined, {
      entity: 'budget', valid_from: '2026-08-01T00:00:00+05:30', supersedes: 'budget-v1',
    })

    expect((await provider.query('user', { at: AT, entity: 'budget' })).map(entry => entry.key)).toEqual(['budget-v2'])
    expect((await provider.query('user', { at: '2026-07-01T12:00:00+05:30', entity: 'budget' })).map(entry => entry.key)).toEqual(['budget-v1'])
  })

  it('honors an explicit supersedes link outside an entity group', async () => {
    await provider.write('user', 'old', 'Old answer')
    await provider.write('user', 'new', 'New answer', undefined, { supersedes: 'old' })
    expect((await provider.query('user', { at: AT, text: 'answer' })).map(entry => entry.key)).toEqual(['new'])
  })

  it('filters by relation and lexical content after temporal selection', async () => {
    await provider.write('user', 'handoff-note', 'Send the Kyoto handoff', [{ target: 'ravi', relation: 'manager' }])
    await provider.write('user', 'other-note', 'Send the Kyoto handoff', [{ target: 'ravi', relation: 'peer' }])
    expect((await provider.query('user', { at: AT, relation: 'manager', text: 'kyoto' })).map(entry => entry.key)).toEqual(['handoff-note'])
  })
})

describe('Recall tool', () => {
  it('renders time-aware memory results', async () => {
    const provider = providers()[0]
    await provider.write('user', 'trip', 'Flight AI-812', undefined, { entity: 'travel/delhi' })
    const result = await recallTool.execute({ scope: 'user', entity: 'travel/', at: AT }, { memory: provider } as any)
    expect(result).toContain('trip')
    expect(result).toContain('Flight AI-812')
  })
})

describe('legacy memory format', () => {
  it('loads a pre-temporal markdown file as eternally current', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'harness-temporal-legacy-'))
    mkdirSync(join(artifactDir, 'memory'))
    writeFileSync(join(artifactDir, 'memory', 'legacy.md'), 'Old format memory\n')
    const provider = new FsMemoryProvider(artifactDir, createSession('test', 'legacy-user'))
    expect((await provider.query('profile', { at: AT })).map(entry => entry.key)).toEqual(['legacy'])
  })
})
