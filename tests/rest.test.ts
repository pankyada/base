import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { createServer, Server } from 'http'
import type { AddressInfo } from 'net'
import { createRestHandler } from '../src/server/rest.js'
import { runProfileOnce } from '../src/server/run-profile.js'

vi.mock('../src/server/run-profile.js', () => ({ runProfileOnce: vi.fn() }))
vi.mock('../src/profiles/loader.js', () => ({
  loadProfile: vi.fn().mockReturnValue({ name: 'named', contract: undefined }),
}))

const FREEFORM_PROFILE = { name: 'default', contract: undefined } as any
const CONTRACT_PROFILE = {
  name: 'typed',
  contract: {
    input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
  },
} as any

function startServer(handler: (req: any, res: any) => void): Promise<{ server: Server; base: string }> {
  return new Promise(resolve => {
    const server = createServer((req, res) => handler(req, res))
    server.listen(0, () => {
      const addr = server.address() as AddressInfo
      resolve({ server, base: `http://127.0.0.1:${addr.port}` })
    })
  })
}

describe('REST /health and /run (no auth)', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())
  beforeEach(() => {
    vi.mocked(runProfileOnce).mockReset().mockResolvedValue({
      finalText: 'hello', usage: { tokens_in: 1, tokens_out: 2, cost_usd: 0.0 }, session: { id: 'sess1' } as any,
    })
  })

  it('GET /health returns 200 with profile name', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', profile: 'default' })
  })

  it('POST /run freeform returns 200 with string output and usage', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ output: 'hello', usage: { tokens_in: 1, tokens_out: 2, cost_usd: 0.0 }, session_id: 'sess1' })
  })

  it('POST /run missing input returns 400', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ user: 'a' }) })
    expect(res.status).toBe(400)
  })

  it('POST /run malformed JSON returns 400', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('unknown route returns 404', async () => {
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
  })
})

describe('REST /run typed contract', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: CONTRACT_PROFILE, apiKey: undefined })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('returns 422 when object input violates the input schema', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: { wrong: 1 } }) })
    expect(res.status).toBe(422)
  })

  it('returns 200 with object output when contract is satisfied', async () => {
    vi.mocked(runProfileOnce).mockResolvedValue({
      finalText: '{"findings":"ok"}', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 's' } as any,
    })
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: { query: 'x' } }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ output: { findings: 'ok' } })
  })

  it('returns 422 when the agent output violates the output schema', async () => {
    vi.mocked(runProfileOnce).mockResolvedValue({
      finalText: '{"wrong":1}', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 's' } as any,
    })
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: { query: 'x' } }) })
    expect(res.status).toBe(422)
  })
})

describe('REST auth', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: 'secret' })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('GET /health is exempt from auth', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it('POST /run without bearer returns 401', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(401)
  })

  it('POST /run with correct bearer returns 200', async () => {
    vi.mocked(runProfileOnce).mockResolvedValue({
      finalText: 'ok', usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, session: { id: 's' } as any,
    })
    const res = await fetch(`${base}/run`, {
      method: 'POST', headers: { authorization: 'Bearer secret' }, body: JSON.stringify({ input: 'hi' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('REST /stream (SSE)', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('streams a terminal result event with output and usage', async () => {
    vi.mocked(runProfileOnce).mockImplementation(async (opts: any) => {
      opts.events.onToken('hel')
      opts.events.onToken('lo')
      opts.events.onStats(2, 3, 0.001)
      return { finalText: 'hello', usage: { tokens_in: 2, tokens_out: 3, cost_usd: 0.001 }, session: { id: 'sX' } as any }
    })
    const res = await fetch(`${base}/stream`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: token')
    expect(text).toContain('event: stats')
    expect(text).toContain('event: result')
    expect(text).toContain('"output":"hello"')
    expect(text).toContain('"session_id":"sX"')
  })

  it('returns a normal 422 (not SSE) when pre-run input validation fails', async () => {
    const res = await fetch(`${base}/stream`, { method: 'POST', body: JSON.stringify({}) })
    expect(res.status).toBe(400) // missing input
  })
})
