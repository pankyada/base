import chokidar, { type FSWatcher } from 'chokidar'
import { resolve } from 'path'
import { recentlyWritten } from './suppression.js'

export interface WatchConfig {
  name: string
  path: string
  events?: Array<'add' | 'change' | 'unlink'>
  debounce_ms?: number
  ignore?: string[]
  max_batch?: number
  mode?: 'skip' | 'queue' | 'parallel'
}

export type WatchFire = (input: Record<string, unknown>, config: WatchConfig) => Promise<void>

export class WatchTrigger {
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private events = new Map<string, 'add' | 'change' | 'unlink'>()

  constructor(private readonly config: WatchConfig, private readonly fire: WatchFire) {}

  start(): void {
    const ignored = [
      '**/.git/**', '**/node_modules/**', '**/.DS_Store', '**/*.swp', '**/*~', '**/.#*',
      ...(this.config.ignore ?? []),
    ]
    this.watcher = chokidar.watch(resolve(this.config.path), { ignoreInitial: true, ignored })
    for (const event of this.config.events ?? ['add', 'change', 'unlink']) this.watcher.on(event, path => this.record(event, path))
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.events.clear()
    await this.watcher?.close()
  }

  record(type: 'add' | 'change' | 'unlink', path: string): void {
    const debounce = this.config.debounce_ms ?? 2_000
    if (recentlyWritten(path, debounce * 2)) return
    this.events.set(resolve(path), type)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, debounce)
  }

  async flush(): Promise<void> {
    this.timer = null
    const max = this.config.max_batch ?? 50
    const events = [...this.events.entries()].map(([path, type]) => ({ type, path }))
    this.events.clear()
    if (!events.length) return
    const truncated = events.length > max
    const sample = events.slice(0, max)
    await this.fire({
      trigger: 'watch',
      name: this.config.name,
      events: sample,
      sample_paths: sample.map(event => event.path),
      changed_count: events.length,
      truncated,
    }, this.config)
  }
}
