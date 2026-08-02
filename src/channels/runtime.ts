import { randomUUID, timingSafeEqual } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import type { Profile } from '../profiles/schema.js'
import type { InputRequestKind, RiskLevel } from '../types.js'
import { BindingStore } from './bindings.js'
import { prepareChannelMessages } from './chunk.js'
import { registerBuiltinChannels } from './builtin/index.js'
import { loadAllCustomChannels, resolveChannelsDirs } from './loader.js'
import { getAllChannels, resolveChannel } from './registry.js'
import type { ChannelAdapter, ChannelInboundRoute, ChannelMessage, InboundMessage, ChannelProfileConfig } from './types.js'

interface PendingResponse {
  transport: string
  identity: string
  resolve: (value: string) => void
}

export interface ChannelSendResult {
  ok: boolean
  error?: string
}

export type ChannelInboundHandler = (route: ChannelInboundRoute) => Promise<void>

export class ChannelRuntime {
  private readonly configs: ChannelProfileConfig[]
  private readonly adapters = new Map<string, ChannelAdapter>()
  private readonly sends = new Map<string, number[]>()
  private readonly pending = new Map<string, PendingResponse>()
  private inboundHandler: ChannelInboundHandler | undefined
  private started = false

  constructor(
    private readonly profile: Profile,
    readonly bindings = new BindingStore(),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.configs = (profile.channels ?? []) as ChannelProfileConfig[]
  }

  get enabled(): boolean { return this.configs.length > 0 }

  get configuredNames(): string[] { return this.configs.map(config => config.name) }

  async init(): Promise<void> {
    if (!this.enabled || this.started) return
    registerBuiltinChannels()
    for (const adapter of await loadAllCustomChannels(resolveChannelsDirs())) {
      const existing = getAllChannels().find(item => item.name === adapter.name)
      if (!existing || adapter.name !== 'stdout' && adapter.name !== 'webhook') {
        const { registerChannel } = await import('./registry.js')
        registerChannel(adapter)
      }
    }
    for (const config of this.configs) {
      const adapter = resolveChannel(config.transport)
      if (!adapter) throw new Error(`channel '${config.name}' transport '${config.transport}' not found`)
      await adapter.init(config.config)
      this.adapters.set(config.name, adapter)
    }
    for (const config of this.configs) {
      if (config.inbound) {
        const adapter = this.adapters.get(config.name)!
        await adapter.start(message => this.receive(config.name, message))
      }
    }
    this.started = true
  }

  async stop(): Promise<void> {
    for (const adapter of new Set(this.adapters.values())) await adapter.stop().catch(() => {})
    this.started = false
  }

  onInbound(handler: ChannelInboundHandler): void {
    this.inboundHandler = handler
  }

  private configFor(name?: string): ChannelProfileConfig | undefined {
    if (name) return this.configs.find(config => config.name === name)
    return this.configs.find(config => config.default) ?? this.configs[0]
  }

  private targetFor(config: ChannelProfileConfig, user: string): { adapter: ChannelAdapter; identity: string } | ChannelSendResult {
    const adapter = this.adapters.get(config.name)
    if (!adapter) return { ok: false, error: `channel '${config.name}' is not initialized` }
    const binding = this.bindings.findForUser(config.transport, user)
    if (!binding) return { ok: false, error: `[no bound recipient for channel '${config.name}']` }
    return { adapter, identity: binding.identity }
  }

  private withinLimit(config: ChannelProfileConfig, user: string): boolean {
    const limit = config.limits?.max_sends_per_hour
    if (!limit) return true
    const key = `${config.name}:${user}`
    const cutoff = this.now() - 60 * 60 * 1000
    const recent = (this.sends.get(key) ?? []).filter(timestamp => timestamp >= cutoff)
    if (recent.length >= limit) {
      this.sends.set(key, recent)
      return false
    }
    recent.push(this.now())
    this.sends.set(key, recent)
    return true
  }

  async send(user: string, name: string | undefined, message: ChannelMessage): Promise<ChannelSendResult> {
    const config = this.configFor(name)
    if (!config) return { ok: false, error: `[no configured channel${name ? ` '${name}'` : ''}]` }
    if (config.acl.notify === 'deny') return { ok: false, error: `[notify denied for channel '${config.name}']` }
    if (!this.withinLimit(config, user)) return { ok: false, error: `[send limit reached for channel '${config.name}']` }
    const target = this.targetFor(config, user)
    if ('ok' in target) return target
    for (const chunk of prepareChannelMessages(message, target.adapter.capabilities)) {
      const result = await target.adapter.send(chunk, target.identity)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  private async sendDirect(config: ChannelProfileConfig, identity: string, message: ChannelMessage): Promise<ChannelSendResult> {
    const adapter = this.adapters.get(config.name)
    if (!adapter) return { ok: false, error: `channel '${config.name}' is not initialized` }
    for (const chunk of prepareChannelMessages(message, adapter.capabilities)) {
      const result = await adapter.send(chunk, identity)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  async receive(channel: string, message: InboundMessage): Promise<void> {
    const config = this.configFor(channel)
    if (!config || !config.inbound || config.acl.inbound === 'off') return

    if (message.correlation_id) {
      const pending = this.pending.get(message.correlation_id)
      if (pending && pending.transport === config.transport && pending.identity === message.identity) {
        this.pending.delete(message.correlation_id)
        pending.resolve(message.button_id ?? message.text)
        return
      }
    }

    let binding = this.bindings.get(config.transport, message.identity)
    if (!binding) {
      if (config.acl.inbound === 'open') {
        binding = { user: String(config.config.default_user ?? process.env.HARNESS_USER ?? 'default'), profile: this.profile.name, bound_at: new Date(this.now()).toISOString(), label: config.name }
        this.bindings.bind(config.transport, message.identity, binding)
      } else if (config.acl.inbound === 'paired' && this.bindings.markPairingNotice(config.transport, message.identity)) {
        await this.sendDirect(config, message.identity, { text: 'Pairing required before inbound messages can run.' })
        return
      } else {
        return
      }
    }
    await this.inboundHandler?.({ channel, binding, message })
  }

  private async request(user: string, message: ChannelMessage, timeoutMs: number): Promise<string | null> {
    const config = this.configs.find(item => item.acl.approvals && item.inbound !== false && item.acl.inbound !== 'off')
    if (!config) return null
    const binding = this.bindings.findForUser(config.transport, user)
    if (!binding) return null
    const correlationId = randomUUID().replace(/-/g, '').slice(0, 12)
    const result = await this.send(user, config.name, { ...message, correlation_id: correlationId })
    if (!result.ok) return null
    return new Promise<string | null>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId)
        resolve(null)
      }, timeoutMs)
      this.pending.set(correlationId, {
        transport: config.transport,
        identity: binding.identity,
        resolve: value => { clearTimeout(timer); resolve(value) },
      })
    })
  }

  async requestApproval(user: string, name: string, input: Record<string, unknown>, risk?: RiskLevel, reason?: string): Promise<boolean> {
    const preview = JSON.stringify(input).slice(0, 500)
    const answer = await this.request(user, {
      text: `Approve ${name}?${risk ? ` Risk: ${risk}.` : ''}${reason ? ` ${reason}` : ''}\n${preview}`,
      buttons: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }, { id: 'always', label: 'Always' }],
    }, 5 * 60 * 1000)
    return answer === 'allow' || answer === 'always' || answer === '1'
  }

  async requestInput(user: string, prompt: string, kind: InputRequestKind, options?: string[]): Promise<string | null> {
    const buttons = options?.map((label, index) => ({ id: String(index + 1), label }))
    return this.request(user, { text: prompt, buttons: kind === 'text' ? undefined : buttons }, 30 * 60 * 1000)
  }

  async handleHttp(channelName: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const config = this.configFor(channelName)
    if (!config || config.transport !== 'webhook' || req.method !== 'POST') return false
    const expected = typeof config.config.secret_env === 'string' ? process.env[config.config.secret_env] : undefined
    if (!expected) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'channel secret is not configured' }))
      return true
    }
    const supplied = req.headers['x-channel-secret']
    const actual = Array.isArray(supplied) ? supplied[0] : supplied
    const expectedBytes = Buffer.from(expected)
    const actualBytes = Buffer.from(actual ?? '')
    if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return true
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer)
    let body: any
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'malformed JSON body' }))
      return true
    }
    if (typeof body.identity !== 'string' || typeof body.text !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'identity and text required' }))
      return true
    }
    await this.receive(channelName, {
      identity: body.identity,
      text: body.text,
      correlation_id: typeof body.correlation_id === 'string' ? body.correlation_id : undefined,
      button_id: typeof body.button_id === 'string' ? body.button_id : undefined,
      received_at: new Date().toISOString(),
    })
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return true
  }
}
