import { existsSync, writeFileSync } from 'node:fs'

const bodyFile = process.env.HARNESS_CODEX_FIXTURE_BODY_FILE
let modelsCalls = 0

globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (new URL(url).pathname.endsWith('/models')) {
    const call = ++modelsCalls
    if (process.env.HARNESS_CODEX_FIXTURE_MODELS_MARKER) writeFileSync(process.env.HARNESS_CODEX_FIXTURE_MODELS_MARKER, 'started', 'utf8')
    if (process.env.HARNESS_CODEX_FIXTURE_RELEASE_FILE && (!process.env.HARNESS_CODEX_FIXTURE_RACE_MODE || call === 1)) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('fixture release timeout')) }, 10_000)
      const timer = setInterval(() => { if (existsSync(process.env.HARNESS_CODEX_FIXTURE_RELEASE_FILE)) { clearInterval(timer); clearTimeout(timeout); resolve(undefined) } }, 5)
    })
    const slug = process.env.HARNESS_CODEX_FIXTURE_RACE_MODE && call === 1 ? 'gpt-first' : process.env.HARNESS_CODEX_FIXTURE_RACE_MODE ? 'gpt-second' : 'gpt-future'
    const response = new Response(JSON.stringify({ models: [{
      slug, visibility: 'list', default_reasoning_level: 'low',
      supported_reasoning_levels: [{ effort: 'low', description: 'fixture low' }],
    }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (process.env.HARNESS_CODEX_FIXTURE_MODELS_DONE) writeFileSync(process.env.HARNESS_CODEX_FIXTURE_MODELS_DONE, String(call), 'utf8')
    return response
  }
  if (url.endsWith('/responses')) {
    if (bodyFile && init?.body) writeFileSync(bodyFile, String(init.body), 'utf8')
    const event = { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'fixture complete' }] }], usage: { input_tokens: 1, output_tokens: 1 } } }
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response(JSON.stringify({ error: 'unexpected fixture network request' }), { status: 500, headers: { 'content-type': 'application/json' } })
}
