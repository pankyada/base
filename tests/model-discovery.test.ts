import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCodexCredential } from '../src/provider/auth/store.js'
import { discoverProfileModels } from '../src/models/discovery.js'
import type { Profile } from '../src/profiles/schema.js'

describe('runtime provider catalog', () => {
  it('returns selectable Codex models from the same discovery used by setup', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'runtime-models-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'fixture-token', refresh_token: 'fixture-refresh', account_id: 'fixture-account', expires_at: Date.now() + 3600000 }, homeDir)
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list' }, { slug: 'gpt-5.6-sol', visibility: 'list' }] })))
    try {
      const profile = { model: { auth: 'codex_oauth', id: 'gpt-5.4-mini' } } as Profile
      const models = await discoverProfileModels(profile, { homeDir })
      expect(models.map(model => model.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol'])
      expect(models.every(model => model.available)).toBe(true)
    } finally { mock.mockRestore(); rmSync(homeDir, { recursive: true, force: true }) }
  })
})
