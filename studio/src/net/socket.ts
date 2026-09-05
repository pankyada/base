import type { ClientMessage, ServerMessage } from '../protocol.js'

export class StudioSocket {
  private ws?: WebSocket
  private retry?: number
  constructor(private readonly onMessage: (message: ServerMessage) => void, private readonly onState: (state: 'connecting' | 'open' | 'closed') => void) {}

  connect(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:7337`): void {
    this.onState('connecting')
    this.ws = new WebSocket(url)
    this.ws.onopen = () => { this.onState('open'); this.send({ type: 'hello', user_id: 'operator', protocol_version: 4 }) }
    this.ws.onmessage = event => {
      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as ServerMessage
        this.onMessage(message)
        if (message.type === 'session_ready') {
          this.send({ type: 'agents_list' })
          this.send({ type: 'mission_list' })
          this.send({ type: 'challenge_list' })
        }
      } catch { /* ignore malformed peer data */ }
    }
    this.ws.onclose = () => {
      this.onState('closed')
      window.clearTimeout(this.retry)
      this.retry = window.setTimeout(() => this.connect(url), 1_000)
    }
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  close(): void { window.clearTimeout(this.retry); this.ws?.close() }
}
