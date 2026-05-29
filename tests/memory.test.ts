import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { createSession } from '../src/session/store.js'

describe('FsMemoryProvider', () => {
  let artifactDir: string
  let provider: FsMemoryProvider

  beforeEach(() => {
    artifactDir = mkdtempSync(join(tmpdir(), 'harness-mem-'))
    provider = new FsMemoryProvider(artifactDir, createSession('test', 'testuser'))
  })

  it('reads and writes session memory', async () => {
    await provider.write('session', 'foo', 'bar')
    expect(await provider.read('session', 'foo')).toBe('bar')
  })

  it('returns null for missing session key', async () => {
    expect(await provider.read('session', 'missing')).toBeNull()
  })

  it('reads and writes profile memory files', async () => {
    await provider.write('profile', 'project-context', '# Context\nThis is a test.')
    const content = await provider.read('profile', 'project-context')
    expect(content).toContain('This is a test.')
  })

  it('lists profile memory entries', async () => {
    await provider.write('profile', 'key1', 'val1')
    await provider.write('profile', 'key2', 'val2')
    const entries = await provider.list('profile')
    expect(entries.map(e => e.key)).toContain('key1')
    expect(entries.map(e => e.key)).toContain('key2')
  })

  it('builds system prompt section from MEMORY.md', async () => {
    await provider.write('profile', 'context', '# Context\nSomething important.')
    const section = await provider.buildSystemPromptSection()
    expect(section).toContain('Memory')
    expect(section).toContain('context')
  })

  it('deletes a session memory key', async () => {
    await provider.write('session', 'to-delete', 'value')
    await provider.delete('session', 'to-delete')
    expect(await provider.read('session', 'to-delete')).toBeNull()
  })

  it('deletes a profile memory file and rebuilds index', async () => {
    await provider.write('profile', 'removeme', '# content')
    await provider.delete('profile', 'removeme')
    expect(await provider.read('profile', 'removeme')).toBeNull()
    const entries = await provider.list('profile')
    expect(entries.map(e => e.key)).not.toContain('removeme')
  })

  it('delete on missing key does not throw', async () => {
    await expect(provider.delete('session', 'nonexistent')).resolves.toBeUndefined()
    await expect(provider.delete('profile', 'nonexistent')).resolves.toBeUndefined()
  })

  // --- user scope ---
  it('reads and writes user-private memory', async () => {
    await provider.write('user', 'my-key', 'private content')
    const val = await provider.read('user', 'my-key')
    expect(val).toBe('private content')
  })

  it('user-scope write does not appear in profile list', async () => {
    await provider.write('user', 'private-key', 'val')
    const profileEntries = await provider.list('profile')
    expect(profileEntries.map(e => e.key)).not.toContain('private-key')
  })

  it('profile-scope write does not appear in user list', async () => {
    await provider.write('profile', 'shared-key', 'val')
    const userEntries = await provider.list('user')
    expect(userEntries.map(e => e.key)).not.toContain('shared-key')
  })

  it('buildSystemPromptSection merges shared and private with labels', async () => {
    await provider.write('profile', 'shared', '# Shared')
    await provider.write('user', 'mine', '# Mine')
    const section = await provider.buildSystemPromptSection()
    expect(section).toContain('Memory (shared)')
    expect(section).toContain('Memory (yours)')
  })

  it('buildSystemPromptSection omits a tier when empty', async () => {
    await provider.write('profile', 'shared', '# Shared only')
    const section = await provider.buildSystemPromptSection()
    expect(section).toContain('Memory (shared)')
    expect(section).not.toContain('Memory (yours)')
  })

  it('deletes user-scope memory key', async () => {
    await provider.write('user', 'del-me', 'content')
    await provider.delete('user', 'del-me')
    expect(await provider.read('user', 'del-me')).toBeNull()
  })
})
