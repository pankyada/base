import { randomUUID } from 'crypto'
import type { Profile } from '../profiles/schema.js'
import type { RunStore } from '../runs/store.js'
import { runProfileOnce, type RunProfileResult } from '../server/run-profile.js'
import { sanitizeUserId } from '../session/user-paths.js'
import type { ChannelRuntime } from '../channels/runtime.js'
import type { PendingStore } from '../runs/pending.js'
import { isParkSignal } from '../runs/park.js'
import { logEvent } from '../telemetry/logger.js'
import { RunBudget, BudgetExceeded } from '../runs/budget.js'
import { CursorStore } from './cursors.js'
import { PollTrigger, type PollConfig, type PollProbe } from './poll.js'
import { WatchTrigger, type WatchConfig } from './watch.js'
import { CronTrigger } from './cron.js'
import { triggerUserMessage, type TriggerSource } from './input.js'

type Source = TriggerSource
type Mode = 'skip' | 'queue' | 'parallel'
type TriggerConfig = { name?: string; mode?: Mode }

export interface TriggerManagerOptions {
  profile: Profile
  runStore: RunStore
  abortRegistry: Map<string, AbortController>
  channels?: ChannelRuntime
  pendingStore?: PendingStore
  probe?: PollProbe
  validateCronInput?: boolean
  run?: (options: Parameters<typeof runProfileOnce>[0]) => Promise<RunProfileResult>
}

function makeRunId(): string { return randomUUID().replace(/-/g, '').slice(0, 8) }
function triggerKey(source: Source, name?: string): string { return `${source}:${name ?? 'cron'}` }
const globalActive = new Set<string>()

export class TriggerManager {
  private cronTask: CronTrigger | null = null
  private polls: PollTrigger[] = []
  private watches: WatchTrigger[] = []
  private active = new Map<string, number>()
  private queued = new Map<string, { source: Source; config: TriggerConfig; input: unknown }>()
  private readonly user = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous')
  private readonly run: NonNullable<TriggerManagerOptions['run']>

  constructor(private readonly options: TriggerManagerOptions) { this.run = options.run ?? runProfileOnce }

  init(): void {
    const triggers = this.options.profile.triggers
    if (!triggers) return
    if (triggers.cron) {
      this.cronTask = new CronTrigger(this.options.profile, () => this.fire('cron', {}, {}), this.options.validateCronInput ?? Boolean(this.options.profile.contract?.input))
      this.cronTask.init()
    }
    for (const config of (triggers.watch ?? []) as WatchConfig[]) {
      triggerUserMessage(this.options.profile, 'watch', {
        trigger: 'watch', name: config.name, events: [{ type: 'change', path: config.path }],
        sample_paths: [config.path], changed_count: 1, truncated: false,
      })
    }
    for (const config of (triggers.poll ?? []) as PollConfig[]) {
      triggerUserMessage(this.options.profile, 'poll', { trigger: 'poll', name: config.name, cursor: '0' })
    }
    const cursorStore = new CursorStore()
    for (const config of (triggers.poll ?? []) as PollConfig[]) {
      const poll = new PollTrigger(config, this.user, this.options.profile.name, cursorStore,
        this.options.probe ?? (async () => { throw new Error('poll probe unavailable') }),
        (input, cfg) => this.fire('poll', cfg, input),
        (reason, probeMs) => this.telemetry('poll', config.name, false, reason, probeMs),
      )
      this.polls.push(poll)
      poll.start()
    }
    for (const config of (triggers.watch ?? []) as WatchConfig[]) {
      const expanded = config.path.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_match, key) => process.env[key] ?? '')
      const path = expanded.startsWith('/') ? expanded : `${this.options.profile.working_dir}/${expanded}`
      const watch = new WatchTrigger({ ...config, path }, (input, cfg) => this.fire('watch', cfg, input))
      this.watches.push(watch)
      watch.start()
    }
  }

  async stop(): Promise<void> {
    this.cronTask?.stop()
    for (const poll of this.polls) poll.stop()
    await Promise.all(this.watches.map(watch => watch.stop()))
  }

  async fire(source: Source, config: TriggerConfig, input: unknown): Promise<void> {
    const key = triggerKey(source, config.name)
    const mode = config.mode ?? 'skip'
    if ((this.active.get(key) ?? 0) > 0 && mode !== 'parallel') {
      if (mode === 'queue') this.queued.set(key, { source, config, input })
      this.telemetry(source, config.name, false, 'overlap')
      return
    }
    const cap = this.options.profile.triggers?.max_concurrent_runs ?? 3
    if (globalActive.size >= cap) {
      this.telemetry(source, config.name, false, 'overlap')
      return
    }

    const id = makeRunId()
    const abort = new AbortController()
    this.active.set(key, (this.active.get(key) ?? 0) + 1)
    globalActive.add(id)
    this.options.abortRegistry.set(id, abort)
    const triggerInput = source === 'cron' ? this.options.profile.triggers?.cron_input : input
    let userMessage: string
    try {
      userMessage = triggerUserMessage(this.options.profile, source, triggerInput)
    } catch (error) {
      this.options.abortRegistry.delete(id)
      globalActive.delete(id)
      this.decrementActive(key)
      console.error(`[${source}] profile ${this.options.profile.name} trigger input rejected:`, (error as Error).message)
      return
    }

    this.options.runStore.create({ id, profile: this.options.profile.name, user: this.user, trigger: source, input: userMessage, status: 'running', started_at: new Date().toISOString() })
    try {
      const result = await this.run({
        profile: this.options.profile,
        userId: this.user,
        userMessage,
        events: {
          onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
          onToolPrompt: (_id, _name, toolInput, risk, reason) => this.options.channels?.requestApproval(this.user, _name, toolInput, risk, reason) ?? Promise.resolve(false),
          onInputRequest: this.options.channels ? (_id, prompt, kind, choices) => this.options.channels!.requestInput(this.user, prompt, kind, choices).then(value => value ?? '') : undefined,
          onSessionEnd: () => {},
        },
        signal: abort.signal,
        channels: this.options.channels,
        runId: id,
        onSessionCreated: sessionId => this.options.runStore.update(id, { session_id: sessionId }),
        pendingInputs: this.options.pendingStore,
        unattended: true,
        budget: this.options.profile.triggers?.budget ? new RunBudget(this.options.profile.triggers.budget) : undefined,
      })
      this.options.runStore.update(id, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
      this.telemetry(source, config.name, true, undefined, undefined, typeof input === 'object' && input !== null ? Number((input as any).changed_count) || undefined : undefined, result.usage.cost_usd)
    } catch (error: any) {
      const existing = this.options.runStore.get(id)
      if (existing?.status === 'running') this.options.runStore.update(id, {
        status: isParkSignal(error) ? 'waiting_input' : error instanceof BudgetExceeded ? 'budget_exceeded' : 'failed',
        session_id: isParkSignal(error) ? error.sessionId : undefined,
        error: error.message,
        ...(isParkSignal(error) ? {} : { finished_at: new Date().toISOString() }),
      })
      if (error instanceof BudgetExceeded) this.telemetry(source, config.name, false, 'budget')
      else this.telemetry(source, config.name, true, undefined, undefined, typeof input === 'object' && input !== null ? Number((input as any).changed_count) || undefined : undefined)
      console.error(`[trigger] ${source} run failed for profile ${this.options.profile.name}:`, error.message)
    } finally {
      this.options.abortRegistry.delete(id)
      globalActive.delete(id)
      this.decrementActive(key)
      const queued = this.queued.get(key)
      if (queued && (this.active.get(key) ?? 0) === 0) {
        this.queued.delete(key)
        void this.fire(queued.source, queued.config, queued.input)
      }
    }
  }

  private decrementActive(key: string): void {
    const count = (this.active.get(key) ?? 0) - 1
    if (count > 0) this.active.set(key, count)
    else this.active.delete(key)
  }

  private telemetry(source: Source, name: string | undefined, fired: boolean, skip_reason?: 'cursor_unchanged' | 'overlap' | 'budget' | 'probe_error', probeMs?: number, coalesced_events?: number, cost_usd?: number): void {
    logEvent({ session: 'trigger', profile: this.options.profile.name, kind: 'trigger', name, source, trigger: source, fired, skip_reason, probe_ms: probeMs, coalesced_events, cost_usd })
  }
}
