export interface ChannelCapabilities {
  text: boolean
  rich: boolean
  buttons: boolean
  files: boolean
  audio: boolean
  max_chars?: number
}

export interface ChannelMessage {
  text: string
  urgency?: 'low' | 'normal' | 'high'
  buttons?: { id: string; label: string }[]
  files?: { path: string; name?: string }[]
  correlation_id?: string
}

export interface InboundMessage {
  identity: string
  text: string
  correlation_id?: string
  button_id?: string
  files?: { path: string; name?: string }[]
  audio?: { path: string; mime: string; duration_s?: number }
  received_at: string
}

export interface ChannelAdapter {
  readonly name: string
  readonly capabilities: ChannelCapabilities
  init(config: Record<string, unknown>): Promise<void>
  send(msg: ChannelMessage, to: string): Promise<{ ok: boolean; error?: string }>
  start(onInbound: (msg: InboundMessage) => Promise<void>): Promise<void>
  stop(): Promise<void>
  handleHttp?(req: import('http').IncomingMessage, res: import('http').ServerResponse, onInbound: (msg: InboundMessage) => Promise<void>): Promise<boolean>
}

export interface ChannelBinding {
  user: string
  profile: string
  bound_at: string
  label?: string
}

export type ChannelInboundAcl = 'paired' | 'open' | 'off'

export interface ChannelProfileConfig {
  name: string
  transport: string
  inbound: boolean
  default: boolean
  config: Record<string, unknown>
  acl: {
    notify: 'allow' | 'prompt' | 'deny'
    approvals: boolean
    inbound: ChannelInboundAcl
  }
  limits: {
    max_sends_per_hour?: number
  }
}

export interface ChannelInboundRoute {
  channel: string
  binding: ChannelBinding
  message: InboundMessage
}

