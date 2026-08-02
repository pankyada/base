import cron from 'node-cron'
import { randomUUID } from 'crypto'
import type { ScheduledTask } from 'node-cron'
import type { Profile } from '../profiles/schema.js'
import type { RunStore } from '../runs/store.js'
import { runProfileOnce } from '../server/run-profile.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { compileContract, validateAndBuildInput } from '../server/contract.js'
import type { ChannelRuntime } from '../channels/runtime.js'

function makeRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

export class CronScheduler {
  private task: ScheduledTask | null = null

  constructor(
    private profile: Profile,
    private runStore: RunStore,
    private abortRegistry: Map<string, AbortController>,
    private channels?: ChannelRuntime,
  ) {}

  init(): void {
    const expression = this.profile.triggers?.cron
    if (!expression) return

    // Fail-fast: validate cron_input against contract schema at startup, not at first fire
    const cronInput = this.profile.triggers?.cron_input
    if (cronInput !== undefined) {
      const compiled = compileContract(this.profile)
      const check = validateAndBuildInput(cronInput, compiled)
      if (!check.ok) {
        throw new Error(`[cron] profile '${this.profile.name}' cron_input is invalid: ${check.error}`)
      }
    }

    this.task = cron.schedule(expression, async () => {
      const runId = makeRunId()
      const abort = new AbortController()
      this.abortRegistry.set(runId, abort)
      const user = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous')
      const input = this.profile.triggers?.cron_input
      const userMessage = input ? JSON.stringify(input) : ''

      this.runStore.create({
        id: runId,
        profile: this.profile.name,
        user,
        trigger: 'cron',
        input: userMessage,
        status: 'running',
        started_at: new Date().toISOString(),
      })

      try {
        const result = await runProfileOnce({
          profile: this.profile,
          userId: user,
          userMessage,
          events: {
            onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
            onToolPrompt: (name, tool, input, risk, reason) => this.channels?.requestApproval(user, tool, input, risk, reason) ?? Promise.resolve(false),
            onInputRequest: this.channels
              ? (_id, prompt, kind, options) => this.channels!.requestInput(user, prompt, kind, options).then(value => value ?? '')
              : undefined,
            onSessionEnd: () => {}, onStats: () => {},
          },
          signal: abort.signal,
          channels: this.channels,
        })
        this.abortRegistry.delete(runId)
        this.runStore.update(runId, {
          status: 'completed',
          session_id: result.session.id,
          finished_at: new Date().toISOString(),
        })
      } catch (e: any) {
        this.abortRegistry.delete(runId)
        const existing = this.runStore.get(runId)
        if (existing?.status === 'running') {
          this.runStore.update(runId, {
            status: 'failed',
            error: e.message,
            finished_at: new Date().toISOString(),
          })
        }
        console.error(`[cron] run failed for profile ${this.profile.name}:`, e.message)
      }
    })
  }

  stop(): void {
    this.task?.stop()
  }
}
