import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { BindingStore } from '../src/channels/bindings.js'
import { ChannelRuntime } from '../src/channels/runtime.js'
import { registerChannel, clearChannelRegistry } from '../src/channels/registry.js'
import { prepareChannelMessages } from '../src/channels/chunk.js'
import { registerAll, clearRegistry } from '../src/tools/builtin/index.js'
import { getAllTools } from '../src/tools/registry.js'
import { notifyTool } from '../src/tools/builtin/notify.js'
import { CronScheduler } from '../src/scheduler/cron.js'
import { runProfileOnce } from '../src/server/run-profile.js'
import type { ChannelAdapter, InboundMessage } from '../src/channels/types.js'

vi.mock('node-cron', () => ({ default: { schedule: vi.fn().mockReturnValue({ stop: vi.fn() }) } }))
vi.mock('../src/server/run-profile.js', () => ({ runProfileOnce: vi.fn() }))

function profile(channel: Record<string, unknown>) {
  return { name: 'p', channels: [channel] } as any
}

function adapter(name = 'test') {
  const sent: Array<{ text: string; to: string; correlation_id?: string }> = []
  const item: ChannelAdapter = {
    name,
    capabilities: { text: true, rich: false, buttons: false, files: false, audio: false, max_chars: 10 },
    async init() {},
    async send(message, to) { sent.push({ text: message.text, to, correlation_id: message.correlation_id }); return { ok: true } },
    async start() {},
    async stop() {},
  }
  return { item, sent }
}

describe('channels', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-channels-'))
    clearChannelRegistry()
    vi.clearAllMocks()
    vi.mocked(runProfileOnce).mockReset()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('keeps an unbound paired identity inert and sends at most one pairing notice', async () => {
    const fake = adapter()
    fake.item.capabilities.max_chars = undefined
    registerChannel(fake.item)
    const runtime = new ChannelRuntime(profile({ name: 'in', transport: 'test', inbound: true, acl: { inbound: 'paired', notify: 'allow', approvals: false }, config: {}, limits: {} }), new BindingStore(join(root, 'bindings.json')))
    const handler = vi.fn()
    runtime.onInbound(handler)
    await runtime.init()

    const message: InboundMessage = { identity: 'opaque-1', text: 'run tool', received_at: new Date().toISOString() }
    await runtime.receive('in', message)
    await runtime.receive('in', message)

    expect(handler).not.toHaveBeenCalled()
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0].to).toBe('opaque-1')
  })

  it('binds open identities before invoking the route', async () => {
    const fake = adapter()
    registerChannel(fake.item)
    const bindings = new BindingStore(join(root, 'bindings.json'))
    const runtime = new ChannelRuntime(profile({ name: 'in', transport: 'test', inbound: true, acl: { inbound: 'open', notify: 'allow', approvals: false }, config: { default_user: 'bound-user' }, limits: {} }), bindings)
    const handler = vi.fn()
    runtime.onInbound(handler)
    await runtime.init()
    await runtime.receive('in', { identity: 'opaque-2', text: 'hello', received_at: new Date().toISOString() })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0].binding.user).toBe('bound-user')
    expect(bindings.get('test', 'opaque-2')?.profile).toBe('p')
  })

  it('resolves channel approval by opaque correlation id', async () => {
    const fake = adapter()
    registerChannel(fake.item)
    const bindings = new BindingStore(join(root, 'bindings.json'))
    bindings.bind('test', 'opaque-3', { user: 'u', profile: 'p', bound_at: new Date().toISOString() })
    const runtime = new ChannelRuntime(profile({ name: 'in', transport: 'test', inbound: true, acl: { inbound: 'paired', notify: 'allow', approvals: true }, config: {}, limits: {} }), bindings)
    await runtime.init()
    const pending = runtime.requestApproval('u', 'Write', { path: '/tmp/x' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fake.sent[0].correlation_id).toBeTruthy()
    await runtime.receive('in', { identity: 'opaque-3', text: '', button_id: 'allow', correlation_id: fake.sent[0].correlation_id, received_at: new Date().toISOString() })
    await expect(pending).resolves.toBe(true)
  })

  it('chunks and degrades buttons based on capabilities', () => {
    const messages = prepareChannelMessages({ text: '**abcdefghijk**', buttons: [{ id: '1', label: 'Allow' }] }, {
      text: true, rich: false, buttons: false, files: false, audio: false, max_chars: 10,
    })
    expect(messages.map(message => message.text)).toEqual(['abcdefghij', 'k\n1. Allow'])
    expect(messages[1].buttons).toBeUndefined()
  })

  it('registers Notify only when channels exist', () => {
    clearRegistry()
    registerAll()
    expect(getAllTools().some(tool => tool.name === 'Notify')).toBe(false)
    clearRegistry()
    const fake = adapter()
    registerChannel(fake.item)
    const runtime = new ChannelRuntime(profile({ name: 'out', transport: 'test', inbound: false, acl: { inbound: 'off', notify: 'allow', approvals: false }, config: {}, limits: {} }), new BindingStore(join(root, 'bindings.json')))
    registerAll(runtime)
    expect(getAllTools().some(tool => tool.name === 'Notify')).toBe(true)
  })

  it('delivers a cron notification through the configured stdout channel', async () => {
    const cron = await import('node-cron')
    const callback = vi.fn()
    vi.mocked(cron.default.schedule).mockImplementation((_expression, cb) => {
      callback.mockImplementation(cb as any)
      return { stop: vi.fn() } as any
    })
    const bindings = new BindingStore(join(root, 'bindings.json'))
    bindings.bind('stdout', 'operator', { user: 'anonymous', profile: 'p', bound_at: new Date().toISOString() })
    const runtime = new ChannelRuntime(profile({ name: 'out', transport: 'stdout', default: true, inbound: false, acl: { inbound: 'off', notify: 'allow', approvals: false }, config: {}, limits: {} }), bindings)
    await runtime.init()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.mocked(runProfileOnce).mockImplementation(async (opts: any) => {
      const session = { user: 'anonymous' }
      const result = await notifyTool.execute({ text: 'cron fired' }, { session, channels: runtime } as any)
      expect(result).toBe('[notification sent]')
      return { finalText: '', usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, session: { id: 'cron-session' } } as any
    })
    const scheduler = new CronScheduler({ ...profile({}), triggers: { cron: '* * * * *' } } as any, { create: vi.fn(), update: vi.fn(), get: vi.fn().mockReturnValue(null), list: vi.fn(), scanRunning: vi.fn() } as any, new Map(), runtime)
    scheduler.init()
    await callback()
    expect(write).toHaveBeenCalledWith(expect.stringContaining('[channel:operator] cron fired\n'))
    write.mockRestore()
  })

  it('routes authenticated webhook inbound to a session run callback', async () => {
    process.env.CHANNEL_TEST_SECRET = 'test-secret'
    const bindings = new BindingStore(join(root, 'bindings.json'))
    bindings.bind('webhook', 'opaque-webhook-id', { user: 'bound-user', profile: 'p', bound_at: new Date().toISOString() })
    const runtime = new ChannelRuntime(profile({ name: 'in', transport: 'webhook', inbound: true, acl: { inbound: 'paired', notify: 'allow', approvals: false }, config: { url: 'https://example.test/inbound', secret_env: 'CHANNEL_TEST_SECRET' }, limits: {} }), bindings)
    vi.mocked(runProfileOnce).mockResolvedValue({ finalText: 'reply', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 'session-from-webhook' } } as any)
    const sessionRun = vi.fn(async (route: any) => runProfileOnce({
      profile: {} as any,
      userId: route.binding.user,
      userMessage: route.message.text,
      events: {} as any,
    }))
    runtime.onInbound(async route => { await sessionRun(route) })
    await runtime.init()
    const req = Readable.from([JSON.stringify({ identity: 'opaque-webhook-id', text: 'hello from channel' })]) as any
    req.method = 'POST'
    req.headers = { 'x-channel-secret': 'test-secret' }
    const res = { writeHead: vi.fn(), end: vi.fn() } as any
    await runtime.handleHttp('in', req, res)
    expect(sessionRun).toHaveBeenCalledWith(expect.objectContaining({ binding: expect.objectContaining({ user: 'bound-user' }), message: expect.objectContaining({ text: 'hello from channel' }) }))
    expect(runProfileOnce).toHaveBeenCalledWith(expect.objectContaining({ userId: 'bound-user', userMessage: 'hello from channel' }))
    expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object))
    delete process.env.CHANNEL_TEST_SECRET
  })
})
