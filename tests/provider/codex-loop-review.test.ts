import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexProvider } from '../../src/provider/codex/adapter.js'
import { writeCodexCredential, logoutCodex } from '../../src/provider/auth/store.js'
import { runAgentLoop } from '../../src/loop/agent-loop.js'
import { ProfileSchema } from '../../src/profiles/schema.js'
import { createSession } from '../../src/session/store.js'
import { FsMemoryProvider } from '../../src/memory/fs-memory.js'
import { clearRegistry, registerTool } from '../../src/tools/registry.js'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'base-codex-loop-review-')); clearRegistry() })
afterEach(() => { clearRegistry(); rmSync(home, { recursive: true, force: true }) })

function response(output: unknown[]) {
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
    status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5 },
  } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}
function call(argumentsText = '{"path":"fixture"}') {
  return { type: 'function_call', id: 'item-review', call_id: 'call-review', name: 'Read', arguments: argumentsText }
}

async function fixture(fetcher: typeof fetch | any) {
  const record = await writeCodexCredential({ kind: 'codex_oauth', access_token: 'review-access', refresh_token: 'review-refresh',
    expires_at: Date.now() + 600000, account_id: 'review-account' }, home)
  const profile = ProfileSchema.parse({ name: 'codex-review', model: { auth: 'codex_oauth', id: 'gpt-5.4-mini' },
    system_prompt: 'help', artifact_dir: home, tools: { builtin: { Read: 'allow' } }, safety: { enabled: false }, improvement: { enabled: false } })
  const session = createSession(profile.name, 'codex-review')
  session.messages.push({ role: 'system', content: 'Use the supplied tool.' })
  const execute = vi.fn(async () => 'fixture content')
  registerTool({ name: 'Read', description: 'read fixture', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, execute })
  const provider = createCodexProvider(profile.model.id, { home, fetch: fetcher })
  const events = { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn() }
  const context: any = { profile, session, workingDir: home, memory: new FsMemoryProvider(home, session), skills: [], mcpEntries: [], provider, events,
    credentialGeneration: record.generation }
  return { profile, session, context, events, execute }
}

it('runs Codex tool/result continuation through the real Base loop without an API client', async () => {
  const requests: any[] = []
  const f = await fixture(async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return requests.length === 1
      ? response([{ type: 'reasoning', encrypted_content: 'opaque-review', summary: [] }, call()])
      : response([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixture read.' }] }])
  })
  await runAgentLoop('read fixture', f.profile, f.session, f.context, f.events)
  expect(f.execute).toHaveBeenCalledTimes(1)
  expect(requests).toHaveLength(2)
  expect(requests[1].input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'call-review', output: 'fixture content' }))
  expect(requests[1].input.some((item: any) => item.type === 'reasoning' && item.encrypted_content === 'opaque-review')).toBe(true)
  expect(f.session.usage.input).toBe(20)
  expect(f.session.usage.output).toBe(10)
  expect(f.session.usage.cost_usd).toBeGreaterThan(0)
  expect(f.events.onToken.mock.calls.flat().join('')).toContain('Fixture read.')
})

it('never executes malformed Codex tool arguments', async () => {
  const f = await fixture(async () => response([call('{invalid')]))
  await expect(runAgentLoop('read', f.profile, f.session, f.context, f.events)).rejects.toThrow(/JSON|argument/i)
  expect(f.execute).not.toHaveBeenCalled()
})

it('logout after generation starts prevents returned tool execution', async () => {
  const f = await fixture(async () => {
    await logoutCodex(home)
    return response([call()])
  })
  await expect(runAgentLoop('read', f.profile, f.session, f.context, f.events)).rejects.toThrow(/credential|logout|login|account/i)
  expect(f.execute).not.toHaveBeenCalled()
})

it('relogin during generation cannot authorize tools from the previous account', async () => {
  const f = await fixture(async () => {
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'new-account-access', refresh_token: 'new-account-refresh',
      expires_at: Date.now() + 600000, account_id: 'another-account' }, home)
    return response([call()])
  })
  await expect(runAgentLoop('read', f.profile, f.session, f.context, f.events)).rejects.toThrow(/credential|generation|account/i)
  expect(f.execute).not.toHaveBeenCalled()
})
