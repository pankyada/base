import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCodexProvider, CODEX_API_ENDPOINT } from '../src/provider/codex/adapter.js'
import { writeCodexCredential } from '../src/provider/auth/store.js'
import { sanitizeError } from '../src/provider/auth/redact.js'
import type { ProviderClient, ProviderMessage, ProviderResult } from '../src/provider/types.js'

/** No real tools or filesystem actions are exposed to the model by this probe. */
export async function probeCodex(provider: ProviderClient) {
  const results: ProviderResult[] = []
  const text = await provider.generate({
    model: provider.model, messages: [{ role: 'user', content: 'Reply with exactly pong.' }],
  }, { purpose: 'compatibility-probe', deadline: Date.now() + 30_000 })
  if (!text.text.trim() || text.toolCalls.length) throw new Error('Text probe did not return plain text')
  results.push(text)
  const user: ProviderMessage = { role: 'user', content: 'Call probe_echo exactly once with value ok. Wait for its result before answering.' }
  const tools = [{ name: 'probe_echo', description: 'Returns a supplied test value without side effects.',
    parameters: { type: 'object', properties: { value: { type: 'string', enum: ['ok'] } }, required: ['value'], additionalProperties: false } }]
  const called = await provider.generate({ model: provider.model, messages: [user], tools },
    { purpose: 'compatibility-probe', deadline: Date.now() + 30_000 })
  const call = called.toolCalls[0]
  if (called.toolCalls.length !== 1 || call.name !== 'probe_echo' || JSON.parse(call.arguments).value !== 'ok') {
    throw new Error('Tool probe did not return the expected validated function call')
  }
  results.push(called)
  const answered = await provider.generate({ model: provider.model, tools, messages: [
    user,
    { role: 'assistant', content: called.text, tool_calls: called.toolCalls, ...(called.continuation ? { providerState: called.continuation } : {}) },
    { role: 'tool', tool_call_id: call.id, content: '{"value":"ok"}' },
  ] }, { purpose: 'compatibility-probe', deadline: Date.now() + 30_000 })
  if (!answered.text.trim() || answered.toolCalls.length) throw new Error('Tool result round trip did not finish with text')
  results.push(answered)
  return {
    model: provider.model, text: true, tool_roundtrip: true, requests: results.length,
    continuation_returned: Boolean(called.continuation),
    usage: results.map(result => result.usage ?? { status: 'unknown' }),
    billing_verified: false,
  }
}

export async function runMockProbe() {
  const home = mkdtempSync(join(tmpdir(), 'base-codex-probe-'))
  let calls = 0
  try {
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
      expires_at: Date.now() + 3600_000, account_id: 'synthetic-account' }, home)
    const provider = createCodexProvider('gpt-5.4-mini', { home, fetch: async (url, init) => {
      if (String(url) !== CODEX_API_ENDPOINT || init?.redirect !== 'error') throw new Error('Probe attempted an unexpected destination')
      const request = JSON.parse(String(init.body))
      if (request.store !== false || request.stream !== true || !request.include?.includes('reasoning.encrypted_content')) {
        throw new Error('Probe request is missing stateless Responses fields')
      }
      calls++
      if (calls === 3 && !request.input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'probe-call')) {
        throw new Error('Probe dropped function call identity')
      }
      const output = calls === 2 ? [
        { type: 'reasoning', encrypted_content: 'synthetic-opaque-state', summary: [] },
        { type: 'function_call', id: 'probe-item', call_id: 'probe-call', name: 'probe_echo', arguments: '{"value":"ok"}' },
      ] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: calls === 1 ? 'pong' : 'ok' }] }]
      return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
        status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5 },
      } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    } })
    return { mode: 'mock' as const, ...await probeCodex(provider) }
  } finally { rmSync(home, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--mock') console.log(JSON.stringify(await runMockProbe(), null, 2))
    else if (args[0] === '--live' && (args.length === 1 || (args.length === 3 && args[1] === '--model'))) {
      console.log(JSON.stringify({ mode: 'live', ...await probeCodex(createCodexProvider(args[2] ?? 'gpt-5.4-mini')) }, null, 2))
    } else {
      console.error('Usage: pnpm exec tsx scripts/probe-codex.ts --mock | --live [--model ID]')
      process.exitCode = 2
    }
  } catch (error) { console.error(sanitizeError(error)); process.exitCode = 1 }
}
