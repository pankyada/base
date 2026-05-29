import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { createSession } from '../src/session/store.js'
import { memoryLinkedTool } from '../src/tools/builtin/memory-linked.js'
import type { ToolContext } from '../src/tools/types.js'

function makeCtx(provider: FsMemoryProvider): ToolContext {
  return { memory: provider } as unknown as ToolContext
}

describe('MemoryLinked tool', () => {
  let provider: FsMemoryProvider
  let ctx: ToolContext

  beforeEach(async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'harness-linked-'))
    provider = new FsMemoryProvider(artifactDir, createSession('test', 'testuser'))
    ctx = makeCtx(provider)

    // Set up a small graph:
    // auth → [depends_on: crypto, relates_to: session]
    // session → [depends_on: db]
    // crypto (no outgoing links)
    await provider.write('profile', 'auth', '# Auth module', [
      { target: 'crypto', relation: 'depends_on' },
      { target: 'session', relation: 'relates_to' },
    ])
    await provider.write('profile', 'session', '# Session module', [
      { target: 'db', relation: 'depends_on' },
    ])
    await provider.write('profile', 'crypto', '# Crypto module')
    await provider.write('profile', 'db', '# Database')
  })

  it('returns forward links (what key links to)', async () => {
    const result = await memoryLinkedTool.execute({ scope: 'profile', key: 'auth' }, ctx)
    expect(result).toContain('auth links to')
    expect(result).toContain('crypto')
    expect(result).toContain('session')
  })

  it('returns reverse links (what links to key)', async () => {
    const result = await memoryLinkedTool.execute({ scope: 'profile', key: 'crypto' }, ctx)
    expect(result).toContain('Links to crypto')
    expect(result).toContain('auth')
  })

  it('returns both forward and reverse links', async () => {
    const result = await memoryLinkedTool.execute({ scope: 'profile', key: 'session' }, ctx)
    // session links to db (forward)
    expect(result).toContain('session links to')
    expect(result).toContain('db')
    // auth links to session (reverse)
    expect(result).toContain('Links to session')
    expect(result).toContain('auth')
  })

  it('filters by relation type', async () => {
    const result = await memoryLinkedTool.execute({ scope: 'profile', key: 'auth', relation: 'depends_on' }, ctx)
    expect(result).toContain('crypto')
    expect(result).not.toContain('session')
  })

  it('returns not-found message when no links exist', async () => {
    // orphan has no outgoing or incoming links
    await provider.write('profile', 'orphan', '# Orphan node')
    const result = await memoryLinkedTool.execute({ scope: 'profile', key: 'orphan' }, ctx)
    expect(result).toContain('No linked memories found')
  })

  it('returns not-found for a key with no matching relation filter', async () => {
    const result = await memoryLinkedTool.execute({ scope: 'profile', key: 'auth', relation: 'nonexistent' }, ctx)
    expect(result).toContain('No linked memories found')
  })
})
