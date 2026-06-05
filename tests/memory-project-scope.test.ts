import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
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
})
