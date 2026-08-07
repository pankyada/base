import type { Profile } from '../profiles/schema.js'
import type { RunStore } from '../runs/store.js'
import type { ChannelRuntime } from '../channels/runtime.js'
import type { PendingStore } from '../runs/pending.js'
import { TriggerManager } from '../triggers/manager.js'

/** Backward-compatible import path; trigger ownership now lives in TriggerManager. */
export class CronScheduler {
  private readonly manager: TriggerManager

  constructor(
    profile: Profile,
    runStore: RunStore,
    abortRegistry: Map<string, AbortController>,
    channels?: ChannelRuntime,
    pendingStore?: PendingStore,
  ) {
    this.manager = new TriggerManager({ profile, runStore, abortRegistry, channels, pendingStore, validateCronInput: true })
  }

  init(): void { this.manager.init() }
  stop(): void { void this.manager.stop() }
}
