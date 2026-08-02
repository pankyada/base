import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import type { ChannelBinding } from './types.js'

export function bindingKey(transport: string, identity: string): string {
  return `${transport}:${identity}`
}

export class BindingStore {
  private bindings = new Map<string, ChannelBinding>()
  private pairingNotices = new Set<string>()
  private readonly noticesPath: string

  constructor(private readonly filePath = join(homedir(), '.harness', 'channel-bindings.json')) {
    this.noticesPath = `${filePath}.pairing-notices`
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, ChannelBinding>
        for (const [key, value] of Object.entries(raw)) this.bindings.set(key, value)
      }
      if (existsSync(this.noticesPath)) {
        const raw = JSON.parse(readFileSync(this.noticesPath, 'utf8')) as string[]
        this.pairingNotices = new Set(raw)
      }
    } catch (error: any) {
      throw new Error(`invalid channel binding store: ${error.message}`)
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.bindings), null, 2) + '\n', 'utf8')
  }

  private persistNotices(): void {
    mkdirSync(dirname(this.noticesPath), { recursive: true })
    writeFileSync(this.noticesPath, JSON.stringify([...this.pairingNotices], null, 2) + '\n', 'utf8')
  }

  get(transport: string, identity: string): ChannelBinding | undefined {
    return this.bindings.get(bindingKey(transport, identity))
  }

  findForUser(transport: string, user: string): { identity: string; binding: ChannelBinding } | undefined {
    const prefix = `${transport}:`
    for (const [key, binding] of this.bindings) {
      if (key.startsWith(prefix) && binding.user === user) {
        return { identity: key.slice(prefix.length), binding }
      }
    }
    return undefined
  }

  bind(transport: string, identity: string, binding: ChannelBinding): void {
    this.bindings.set(bindingKey(transport, identity), binding)
    this.persist()
  }

  markPairingNotice(transport: string, identity: string): boolean {
    const key = bindingKey(transport, identity)
    if (this.pairingNotices.has(key)) return false
    this.pairingNotices.add(key)
    this.persistNotices()
    return true
  }
}
