import { afterAll, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const fixture = vi.hoisted(() => ({ home: '' }))
vi.mock('os', async original => ({ ...await original<typeof import('os')>(), homedir: () => fixture.home }))
import { createSession, saveSession, loadSession, listSessionSummaries } from '../../src/session/store.js'
import { project } from '../../src/context/projection.js'
import { ProfileSchema } from '../../src/profiles/schema.js'
fixture.home = mkdtempSync(join(tmpdir(), 'base-codex-persistence-'))
afterAll(() => rmSync(fixture.home, { recursive: true, force: true }))

it('retains validated continuation on disk and projection while keeping summaries public', async () => {
  const session = createSession('codex', 'fixture')
  const state = { version: 1, accountGeneration: 'generation', model: 'gpt-5.4-mini', anchorCallIds: ['call-1'], items: [{ type: 'reasoning', encrypted_content: 'opaque-fixture' }] }
  session.messages = [
    { role: 'system', content: 'help' }, { role: 'user', content: 'read' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', name: 'Read', arguments: '{}' }], providerState: state },
    { role: 'tool', tool_call_id: 'call-1', content: 'content' }, { role: 'assistant', content: 'done' },
  ]
  saveSession(session)
  const loaded = loadSession(session.user, session.id)!
  expect((loaded.messages[2] as any).providerState).toEqual(state)
  expect(JSON.stringify(listSessionSummaries(session.user))).not.toContain('opaque-fixture')
  const profile = ProfileSchema.parse({ name: 'codex', system_prompt: 'help', artifact_dir: fixture.home, model: { auth: 'codex_oauth', id: 'gpt-5.4-mini' } })
  const projected = await project(loaded, profile)
  expect((projected[2] as any).providerState).toEqual(state)
  expect((projected[3] as any).tool_call_id).toBe('call-1')
})

it('discards malformed continuation on reload without deleting the public transcript', () => {
  const session = createSession('codex', 'fixture')
  session.messages = [{ role: 'assistant', content: 'public text', providerState: { version: 1, accountGeneration: 'generation', model: 'gpt-5.4-mini', anchorCallIds: ['orphan'], items: [] } }]
  saveSession(session)
  const loaded = loadSession(session.user, session.id)!
  expect(loaded.messages[0]).toEqual({ role: 'assistant', content: 'public text' })
})
