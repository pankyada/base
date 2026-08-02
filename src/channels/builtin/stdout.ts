import type { ChannelAdapter, ChannelMessage, InboundMessage } from '../types.js'

export const stdoutChannel: ChannelAdapter = {
  name: 'stdout',
  capabilities: { text: true, rich: false, buttons: false, files: false, audio: false, max_chars: 12000 },
  async init() {},
  async send(message: ChannelMessage, to: string) {
    process.stdout.write(`[channel:${to}] ${message.text}\n`)
    return { ok: true }
  },
  async start(_onInbound: (message: InboundMessage) => Promise<void>) {},
  async stop() {},
}

