import type { ChannelAdapter, ChannelMessage, InboundMessage } from '../types.js'

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const webhookChannel: ChannelAdapter = {
  name: 'webhook',
  capabilities: { text: true, rich: true, buttons: true, files: false, audio: false },
  async init(config) {
    const url = asString(config.url)
    if (!url) throw new Error('webhook channel requires config.url')
    try { new URL(url) } catch { throw new Error('webhook channel config.url must be a URL') }
  },
  async send(message: ChannelMessage, to: string) {
    try {
      const response = await fetch(to, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) })
      return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  },
  async start(_onInbound: (message: InboundMessage) => Promise<void>) {},
  async stop() {},
}

