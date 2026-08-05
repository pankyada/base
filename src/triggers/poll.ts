import type { CursorStore } from './cursors.js'

export interface PollConfig {
  name: string
  every: string
  probe: { tool: string; args?: Record<string, unknown> }
  cursor_path: string
  jitter_pct?: number
  mode?: 'skip' | 'queue' | 'parallel'
}

export type PollProbe = (tool: string, args: Record<string, unknown>) => Promise<unknown>
export type PollFire = (input: Record<string, unknown>, config: PollConfig) => Promise<void>
export type PollSkip = (reason: 'cursor_unchanged' | 'probe_error', probeMs?: number) => void

export function intervalMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value)
  if (!match) throw new Error(`invalid poll interval "${value}"`)
  return Number(match[1]) * ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const)[match[2] as 's' | 'm' | 'h' | 'd']
}

export function cursorAt(value: unknown, path: string): string | null {
  const parts = path.split('.').filter(Boolean)
  let current: any = value
  for (const part of parts) {
    const match = /^(\w+)(?:\[(\d+)\])?$/.exec(part)
    if (!match || current === null || current === undefined) return null
    current = current[match[1]]
    if (match[2] !== undefined) current = current?.[Number(match[2])]
  }
  return ['string', 'number', 'boolean'].includes(typeof current) ? String(current) : null
}

export class PollTrigger {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private errors = 0

  constructor(
    private readonly config: PollConfig,
    private readonly user: string,
    private readonly profile: string,
    private readonly cursors: CursorStore,
    private readonly probe: PollProbe,
    private readonly fire: PollFire,
    private readonly skip: PollSkip,
  ) {}

  start(): void { this.schedule() }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer) }

  async tick(): Promise<void> {
    const started = Date.now()
    try {
      const output = await this.probe(this.config.probe.tool, this.config.probe.args ?? {})
      const cursor = cursorAt(output, this.config.cursor_path)
      if (cursor === null) throw new Error(`cursor path "${this.config.cursor_path}" did not resolve to a scalar`)
      const previous = this.cursors.read(this.user, this.profile, this.config.name)
      this.cursors.write(this.user, this.profile, this.config.name, { value: cursor, updated_at: new Date().toISOString(), consecutive_errors: 0 })
      this.errors = 0
      if (!previous || previous.value === undefined) return
      if (previous.value === cursor) return this.skip('cursor_unchanged', Date.now() - started)
      await this.fire({ trigger: 'poll', name: this.config.name, cursor }, this.config)
    } catch {
      const previous = this.cursors.read(this.user, this.profile, this.config.name)
      this.errors = (previous?.consecutive_errors ?? 0) + 1
      this.cursors.write(this.user, this.profile, this.config.name, { value: previous?.value, updated_at: new Date().toISOString(), consecutive_errors: this.errors })
      this.skip('probe_error', Date.now() - started)
    } finally {
      if (!this.stopped) this.schedule()
    }
  }

  private schedule(): void {
    const base = Math.min(3_600_000, intervalMs(this.config.every) * 2 ** this.errors)
    const jitter = base * (this.config.jitter_pct ?? 0) / 100
    const delay = base + (jitter ? Math.round((Math.random() * 2 - 1) * jitter) : 0)
    this.timer = setTimeout(() => { void this.tick() }, delay)
  }
}
