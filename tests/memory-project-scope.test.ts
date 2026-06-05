import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { GraphMemoryProvider } from '../src/memory/graph-memory.js'
import { createSession } from '../src/session/store.js'

describe('project memory scope', () => {
  it('writes and reads project-scoped memory tied to session.project', async () => {
    const artifact = mkdtempSync(join(tmpdir(), 'art-'))
    const session = createSession('coding', 'kira')
    session.project = 'projABCD'
    const mem = new FsMemoryProvider(artifact, session)
    await mem.write('project', 'context', 'Project Alpha goals')
    const got = await mem.read('project', 'context')
    expect(got!.content).toBe('Project Alpha goals')
    const list = await mem.list('project')
    expect(list.map(e => e.key)).toContain('context')
  })

  it('GraphMemoryProvider writes and reads project-scoped memory', async () => {
    const artifact = mkdtempSync(join(tmpdir(), 'gart-'))
    const session = createSession('coding', 'lena')
    session.project = 'projWXYZ'
    const mem = new GraphMemoryProvider(artifact, session)
    await mem.write('project', 'goal', 'Ship v2')
    const got = await mem.read('project', 'goal')
    expect(got!.content).toBe('Ship v2')
    const list = await mem.list('project')
    expect(list.map(e => e.key)).toContain('goal')
  })
})
