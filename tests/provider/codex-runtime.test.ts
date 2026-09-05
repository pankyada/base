import { afterAll, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const fixture = vi.hoisted(() => ({ home: '' }))
vi.mock('os', async original => ({ ...await original<typeof import('os')>(), homedir: () => fixture.home }))
vi.mock('../../src/provider/client.js', () => ({ createProviderClient: () => { throw new Error('API client forbidden in Codex-only run') } }))
vi.mock('../../src/skills/loader.js', () => ({ loadAllSkills: () => [], resolveSkillsDirs: () => [], getGitRoot: () => null }))
import { writeCodexCredential } from '../../src/provider/auth/store.js'
import { ProfileSchema, type Profile } from '../../src/profiles/schema.js'
import { runProfileOnce } from '../../src/server/run-profile.js'
import { clearRegistry, registerTool } from '../../src/tools/registry.js'
import { delegateTool } from '../../src/tools/builtin/delegate.js'
import { readUsage } from '../../src/usage/ledger.js'
fixture.home = mkdtempSync(join(tmpdir(), 'base-codex-runtime-'))
afterAll(() => { clearRegistry(); vi.unstubAllGlobals(); rmSync(fixture.home, { recursive: true, force: true }) })

it('runs root and delegated Codex profiles through REST runtime with no API client or paid fallback', async () => {
  await writeCodexCredential({ kind: 'codex_oauth', access_token: 'fixture-access', refresh_token: 'fixture-refresh', account_id: 'fixture-account', expires_at: Date.now() + 600000 }, fixture.home)
  const prompt = join(fixture.home, 'prompt.md')
  writeFileSync(prompt, 'Be helpful')
  const base = { model: { auth: 'codex_oauth', id: 'gpt-5.4-mini' }, system_prompt: prompt, artifact_dir: join(fixture.home, 'artifacts'), working_dir: fixture.home, safety: { enabled: false }, improvement: { enabled: false }, tools: { builtin: { Delegate: 'allow' } } }
  writeFileSync(join(fixture.home, 'child.yaml'), JSON.stringify({ ...base, name: 'child' }))
  const profile: Profile = ProfileSchema.parse({ ...base, name: 'root', profile_path: join(fixture.home, 'root.yaml') })
  profile.profile_path = join(fixture.home, 'root.yaml')
  let sent = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect((init.headers as any).authorization).toBe('Bearer fixture-access')
    const body = JSON.parse(String(init.body))
    expect(body.store).toBe(false)
    const output = ++sent === 1 ? [{ type: 'function_call', call_id: 'delegate-1', name: 'Delegate', arguments: JSON.stringify({ profile: 'child', task: 'say child' }) }]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: sent === 2 ? 'child done' : 'root done' }] }]
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5 } } })}\n\n`)
  }))
  clearRegistry()
  registerTool(delegateTool)
  const result = await runProfileOnce({ profile, userId: 'fixture', userMessage: 'delegate', events: { onToken() {}, onToolStart() {}, onToolEnd() {}, onToolPrompt: async () => true, onSessionEnd() {} } })
  expect(sent, JSON.stringify(result.session.tool_calls)).toBe(3)
  expect(result.finalText).toBe('root done')
  expect(result.usage).toMatchObject({ billing_mode: 'subscription', cost_basis: 'api_equivalent', billed_cost_usd: null, model_attempts: 3 })
  expect(result.session.usage).toMatchObject({ input: 30, output: 15, model_attempts: 3, billing_mode: 'subscription', cost_basis: 'api_equivalent' })
  expect(readUsage('fixture')?.total).toMatchObject({ input: 30, output: 15, model_attempts: 3 })
})
