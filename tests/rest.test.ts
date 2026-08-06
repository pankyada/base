import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { createServer, Server } from 'http'
import type { AddressInfo } from 'net'
import { createRestHandler } from '../src/server/rest.js'
import { runProfileOnce } from '../src/server/run-profile.js'
import { RunStore } from '../src/runs/store.js'
import type { Skill } from '../src/tools/types.js'

const FAKE_SKILLS: Skill[] = [
  { name: 'web-search', description: 'Search the web', content: '', filePath: '' },
  { name: 'memory', description: 'Store facts', content: '', filePath: '' },
]

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

function makeMockRunStore(): RunStore {
  return {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    list: vi.fn().mockReturnValue([]),
    scanRunning: vi.fn().mockReturnValue([]),
  } as any
}

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
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
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
    const body = await res.json()
    expect(body).toMatchObject({ output: 'hello', usage: { tokens_in: 1, tokens_out: 2, cost_usd: 0.0 }, session_id: 'sess1' })
    expect(typeof body.run_id).toBe('string')
    expect(body.run_id).toHaveLength(8)
  })

  it('selects a registered profile from the request body and reports all profiles in health', async () => {
    const other = { name: 'other', contract: undefined } as any
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, profiles: new Map([['default', FREEFORM_PROFILE], ['other', other]]), apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const health = await fetch(`${base}/health`)
    expect(await health.json()).toMatchObject({ profiles: ['default', 'other'] })
    await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ profile: 'other', input: 'hi' }) })
    expect(runProfileOnce).toHaveBeenLastCalledWith(expect.objectContaining({ profile: other }))
    server.close()
  })

  it('uses the selected profile channel runtime for a multi-profile run', async () => {
    const other = { name: 'other', contract: undefined } as any
    const channels = { enabled: true } as any
    const channelFor = vi.fn().mockReturnValue(channels)
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, profiles: new Map([['default', FREEFORM_PROFILE], ['other', other]]), apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [], channelsForProfile: channelFor })
    const { server, base } = await startServer(handler)
    await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ profile: 'other', input: 'hi' }) })
    expect(channelFor).toHaveBeenCalledWith(other)
    expect(runProfileOnce).toHaveBeenLastCalledWith(expect.objectContaining({ profile: other, channels }))
    server.close()
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

describe('REST ACP — GET /agents', () => {
  const ACP_PROFILE = {
    name: 'myagent',
    description: 'A smart ACP agent',
    interop: { a2a: false, acp: true },
    contract: undefined,
  } as any

  it('returns 404 when interop.acp is false', async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    expect(res.status).toBe(404)
    server.close()
  })

  it('returns 401 without bearer when apiKey is set', async () => {
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: 'secret', runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    expect(res.status).toBe(401)
    server.close()
  })

  it('returns agent list with default profile when acp is enabled', async () => {
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agents).toHaveLength(1)
    expect(body.agents[0]).toEqual({ agent_id: 'myagent', name: 'myagent', description: 'A smart ACP agent' })
    server.close()
  })

  it('returns empty description when profile has no description', async () => {
    const profile = { name: 'noname', interop: { acp: true }, contract: undefined } as any
    const handler = createRestHandler({ defaultProfile: profile, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    const body = await res.json()
    expect(body.agents[0].description).toBe('')
    server.close()
  })
})

describe('REST ACP — POST /agents/:id/runs', () => {
  const ACP_PROFILE = {
    name: 'myagent',
    description: 'A smart ACP agent',
    interop: { a2a: false, acp: true },
    contract: undefined,
  } as any

  let server: Server, base: string
  let mockRunStore: RunStore

  beforeAll(async () => {
    mockRunStore = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map(), skills: [] })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when agent id does not match profile name', async () => {
    const res = await fetch(`${base}/agents/wrongname/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'text', text: 'hello' }] }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for malformed JSON', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when no text input items', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'image' }] }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when input array is missing', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('creates a pending run record and returns run id', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'text', text: 'What is the capital of France?' }] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.run.status).toBe('created')
    expect(typeof body.run.id).toBe('string')
    expect(body.run.id).toHaveLength(8)
    expect(body.run.agent_id).toBe('myagent')
    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'acp',
      status: 'pending',
      input: 'What is the capital of France?',
    }))
  })

  it('concatenates multiple text input items', async () => {
    await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }] }),
    })
    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({ input: 'Hello\nWorld' }))
  })
})

describe('REST ACP — GET /runs/:id/messages', () => {
  const ACP_PROFILE = {
    name: 'myagent',
    description: 'A smart ACP agent',
    interop: { a2a: false, acp: true },
    contract: undefined,
  } as any

  const PENDING_RUN = {
    id: 'run00001',
    profile: 'myagent',
    user: 'anonymous',
    trigger: 'acp' as const,
    input: 'What is the capital of France?',
    status: 'pending' as const,
    started_at: new Date().toISOString(),
  }

  it('returns 404 when run is not found', async () => {
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue(null)
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/runs/notfound/messages`)
    expect(res.status).toBe(404)
    server.close()
  })

  it('returns 404 when run exists but trigger is not acp', async () => {
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue({ ...PENDING_RUN, trigger: 'rest' as any })
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/runs/run00001/messages`)
    expect(res.status).toBe(404)
    server.close()
  })

  it('returns 409 when run is not pending', async () => {
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue({ ...PENDING_RUN, status: 'completed' as any })
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/runs/run00001/messages`)
    expect(res.status).toBe(409)
    server.close()
  })

  it('streams SSE messages and done event on success', async () => {
    vi.mocked(runProfileOnce).mockImplementation(async (opts: any) => {
      opts.events.onToken('Par')
      opts.events.onToken('is.')
      return { finalText: 'Paris.', usage: { tokens_in: 2, tokens_out: 3, cost_usd: 0 }, session: { id: 'sx1' } as any }
    })
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue(PENDING_RUN)
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)

    const res = await fetch(`${base}/runs/run00001/messages`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: message')
    expect(text).toContain('"type":"token"')
    expect(text).toContain('"content":"Par"')
    expect(text).toContain('event: done')
    expect(text).toContain('"output":"Paris."')
    expect(store.update).toHaveBeenCalledWith('run00001', expect.objectContaining({ status: 'running' }))
    expect(store.update).toHaveBeenCalledWith('run00001', expect.objectContaining({ status: 'completed' }))
    server.close()
  })

  it('streams error event and marks run failed when agent throws', async () => {
    vi.mocked(runProfileOnce).mockRejectedValue(new Error('model timeout'))
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue(PENDING_RUN)
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)

    const res = await fetch(`${base}/runs/run00001/messages`)
    const text = await res.text()
    expect(text).toContain('event: error')
    expect(text).toContain('"message":"model timeout"')
    server.close()
  })
})

describe('REST A2A — agent card', () => {
  const A2A_PROFILE = {
    name: 'myagent',
    description: 'A smart agent',
    interop: { a2a: true },
    contract: undefined,
  } as any

  it('GET /.well-known/agent.json returns 404 when interop.a2a is false', async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/.well-known/agent.json`)
    expect(res.status).toBe(404)
    server.close()
  })

  it('GET /.well-known/agent.json returns 401 without bearer when apiKey is set', async () => {
    const handler = createRestHandler({ defaultProfile: A2A_PROFILE, apiKey: 'secret', runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/.well-known/agent.json`)
    expect(res.status).toBe(401)
    server.close()
  })

  it('GET /.well-known/agent.json returns agent card when enabled', async () => {
    const handler = createRestHandler({ defaultProfile: A2A_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: FAKE_SKILLS })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/.well-known/agent.json`)
    expect(res.status).toBe(200)
    const card = await res.json()
    expect(card.name).toBe('myagent')
    expect(card.description).toBe('A smart agent')
    expect(card.url).toContain('/a2a')
    expect(card.capabilities).toEqual({ streaming: false })
    expect(card.authentication).toEqual({ schemes: ['bearer'] })
    expect(card.skills).toHaveLength(2)
    expect(card.skills[0]).toEqual({ id: 'web-search', name: 'web-search', description: 'Search the web' })
    server.close()
  })

  it('GET /.well-known/agent.json returns 200 with valid bearer when apiKey is set', async () => {
    const handler = createRestHandler({ defaultProfile: A2A_PROFILE, apiKey: 'secret', runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/.well-known/agent.json`, { headers: { authorization: 'Bearer secret' } })
    expect(res.status).toBe(200)
    server.close()
  })

  it('GET /.well-known/agent.json returns empty skills array when no skills loaded', async () => {
    const handler = createRestHandler({ defaultProfile: A2A_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/.well-known/agent.json`)
    const card = await res.json()
    expect(card.skills).toEqual([])
    server.close()
  })
})

describe('REST A2A — task endpoint', () => {
  const A2A_PROFILE = {
    name: 'myagent',
    description: 'A smart agent',
    interop: { a2a: true },
    contract: undefined,
  } as any

  let server: Server, base: string
  let mockRunStore: RunStore

  beforeAll(async () => {
    mockRunStore = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: A2A_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map(), skills: [] })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  beforeEach(() => {
    vi.mocked(runProfileOnce).mockReset().mockResolvedValue({
      finalText: 'Paris.', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 'sa1' } as any,
    })
  })

  it('POST /a2a returns 404 when interop.a2a is false', async () => {
    const handler2 = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server: s2, base: b2 } = await startServer(handler2)
    const res = await fetch(`${b2}/a2a`, { method: 'POST', body: JSON.stringify({ id: 't1', message: { parts: [{ type: 'text', text: 'hi' }] } }) })
    expect(res.status).toBe(404)
    s2.close()
  })

  it('POST /a2a returns 400 for malformed JSON', async () => {
    const res = await fetch(`${base}/a2a`, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('POST /a2a returns 400 when no text parts in message', async () => {
    const res = await fetch(`${base}/a2a`, {
      method: 'POST',
      body: JSON.stringify({ id: 't2', message: { parts: [{ type: 'image' }] } }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /a2a returns 200 A2A response on success', async () => {
    const res = await fetch(`${base}/a2a`, {
      method: 'POST',
      body: JSON.stringify({ id: 'task-001', message: { parts: [{ type: 'text', text: 'What is the capital of France?' }] } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('task-001')
    expect(body.status.state).toBe('completed')
    expect(body.artifacts).toHaveLength(1)
    expect(body.artifacts[0].parts[0]).toEqual({ type: 'text', text: 'Paris.' })
    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'a2a', status: 'running' }))
    expect(mockRunStore.update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'completed' }))
  })

  it('POST /a2a returns 200 with state:failed when agent throws', async () => {
    vi.mocked(runProfileOnce).mockRejectedValue(new Error('model timeout'))
    const res = await fetch(`${base}/a2a`, {
      method: 'POST',
      body: JSON.stringify({ id: 'task-002', message: { parts: [{ type: 'text', text: 'hello' }] } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('task-002')
    expect(body.status.state).toBe('failed')
    expect(body.status.error.message).toBe('model timeout')
  })

  it('POST /a2a concatenates multiple text parts', async () => {
    await fetch(`${base}/a2a`, {
      method: 'POST',
      body: JSON.stringify({ id: 't3', message: { parts: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }] } }),
    })
    expect(runProfileOnce).toHaveBeenCalledWith(expect.objectContaining({ userMessage: 'Hello\nWorld' }))
  })

  it('POST /a2a generates a task id when none provided', async () => {
    const res = await fetch(`${base}/a2a`, {
      method: 'POST',
      body: JSON.stringify({ message: { parts: [{ type: 'text', text: 'hi' }] } }),
    })
    const body = await res.json()
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })
})

describe('REST /run typed contract', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: CONTRACT_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
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
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: 'secret', runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
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
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
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

describe('REST /runs lifecycle API', () => {
  let server: Server, base: string
  let mockRunStore: RunStore

  beforeAll(async () => {
    mockRunStore = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map(), skills: [] })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('GET /runs returns empty array when no runs', async () => {
    vi.mocked(mockRunStore.list).mockReturnValue([])
    const res = await fetch(`${base}/runs`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [] })
  })

  it('GET /runs returns list from store', async () => {
    const fakeRun = { id: 'abc12345', profile: 'default', status: 'completed' }
    vi.mocked(mockRunStore.list).mockReturnValue([fakeRun as any])
    const res = await fetch(`${base}/runs`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [fakeRun] })
  })

  it('GET /runs/:id returns 404 when not found', async () => {
    vi.mocked(mockRunStore.get).mockReturnValue(null)
    const res = await fetch(`${base}/runs/notfound`)
    expect(res.status).toBe(404)
  })

  it('GET /runs/:id returns run when found', async () => {
    const fakeRun = { id: 'abc12345', status: 'running' }
    vi.mocked(mockRunStore.get).mockReturnValue(fakeRun as any)
    const res = await fetch(`${base}/runs/abc12345`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'abc12345' })
  })

  it('DELETE /runs/:id returns 404 when not found', async () => {
    vi.mocked(mockRunStore.get).mockReturnValue(null)
    const res = await fetch(`${base}/runs/notfound`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('DELETE /runs/:id returns 409 when run is already completed', async () => {
    vi.mocked(mockRunStore.get).mockReturnValue({ id: 'abc12345', status: 'completed' } as any)
    const res = await fetch(`${base}/runs/abc12345`, { method: 'DELETE' })
    expect(res.status).toBe(409)
  })

  it('DELETE /runs/:id cancels a running run', async () => {
    const abortRegistry = new Map<string, AbortController>()
    const abort = new AbortController()
    abortRegistry.set('run00001', abort)
    vi.mocked(mockRunStore.get).mockReturnValue({ id: 'run00001', status: 'running' } as any)

    const handler2 = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry, skills: [] })
    const { server: s2, base: b2 } = await startServer(handler2)
    const res = await fetch(`${b2}/runs/run00001`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(abort.signal.aborted).toBe(true)
    expect(mockRunStore.update).toHaveBeenCalledWith('run00001', expect.objectContaining({ status: 'cancelled' }))
    s2.close()
  })

  it('POST /run creates a run record', async () => {
    const store = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server: s2, base: b2 } = await startServer(handler)
    vi.mocked(runProfileOnce).mockResolvedValue({
      finalText: 'hi', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 'sx' } as any,
    })
    await fetch(`${b2}/run`, { method: 'POST', body: JSON.stringify({ input: 'hello' }) })
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'rest', status: 'running' }))
    expect(store.update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'completed' }))
    s2.close()
  })
})

describe('REST /webhooks/:profile', () => {
  let server: Server, base: string
  let mockRunStore: RunStore

  const WEBHOOK_PROFILE = {
    name: 'webhookprofile',
    contract: undefined,
    triggers: { webhook: true, cron: undefined, cron_input: undefined },
  } as any

  beforeAll(async () => {
    mockRunStore = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map(), skills: [] })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  beforeEach(() => {
    vi.mocked(runProfileOnce).mockReset().mockResolvedValue({
      finalText: 'done', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 'sw' } as any,
    })
  })

  it('returns 404 for an unknown profile', async () => {
    const { loadProfile } = await import('../src/profiles/loader.js')
    vi.mocked(loadProfile).mockImplementation(() => { throw new Error('not found') })

    const restMod = await import('../src/server/rest.js')
    vi.spyOn(restMod, 'findProfilePath').mockReturnValue('/mock/path.yaml')

    const res = await fetch(`${base}/webhooks/unknown`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(404)

    vi.mocked(restMod.findProfilePath).mockRestore()
  })

  it('returns 404 when profile has webhook: false', async () => {
    const { loadProfile } = await import('../src/profiles/loader.js')
    vi.mocked(loadProfile).mockReturnValue({ name: 'nohook', triggers: { webhook: false } } as any)
    const restMod = await import('../src/server/rest.js')
    vi.spyOn(restMod, 'findProfilePath').mockReturnValue('/mock/path.yaml')

    const res = await fetch(`${base}/webhooks/nohook`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(404)

    vi.mocked(restMod.findProfilePath).mockRestore()
  })

  it('returns 200 with run_id when webhook is enabled', async () => {
    // Rely on defaultProfile fallback logic to resolve
    const handler3 = createRestHandler({ defaultProfile: WEBHOOK_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map(), skills: [] })
    const { server: s3, base: b3 } = await startServer(handler3)

    const res = await fetch(`${b3}/webhooks/webhookprofile`, { method: 'POST', body: JSON.stringify({ input: 'task' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.run_id).toHaveLength(8)
    expect(body.output).toBe('done')
    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'webhook' }))
    s3.close()
  })

  it('returns 400 when input is missing', async () => {
    const handler3 = createRestHandler({ defaultProfile: WEBHOOK_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map(), skills: [] })
    const { server: s3, base: b3 } = await startServer(handler3)

    const res = await fetch(`${b3}/webhooks/webhookprofile`, { method: 'POST', body: JSON.stringify({}) })
    expect(res.status).toBe(400)
    s3.close()
  })
})
