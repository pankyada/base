import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import type { Profile } from '../profiles/schema.js'
import { compileContract, validateAndBuildInput } from '../server/contract.js'

export type CronFire = () => Promise<void>

/** Clock-only trigger. Run ownership stays in TriggerManager.fire(). */
export class CronTrigger {
  private task: ScheduledTask | null = null

  constructor(private readonly profile: Profile, private readonly fire: CronFire, private readonly validateInput = true) {}

  init(): void {
    const expression = this.profile.triggers?.cron
    if (!expression) return
    const cronInput = this.profile.triggers?.cron_input
    if (cronInput !== undefined && this.validateInput) {
      const check = validateAndBuildInput(cronInput, compileContract(this.profile))
      if (!check.ok) throw new Error(`[cron] profile '${this.profile.name}' cron_input is invalid: ${check.error}`)
    }
    this.task = cron.schedule(expression, () => this.fire())
  }

  stop(): void { this.task?.stop() }
}
