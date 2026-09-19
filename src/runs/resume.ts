import { loadSession, saveSession } from '../session/store.js'
import type { AgentLoopEvents } from '../tools/types.js'
import type { Profile } from '../profiles/schema.js'
import type { ChannelRuntime } from '../channels/runtime.js'
import { runProfileOnce } from '../server/run-profile.js'
import type { RunStore } from './store.js'
import type { PendingInput, PendingStore, PendingAnsweredVia } from './pending.js'
import { isParkSignal } from './park.js'
import type { RunProfileOptions } from '../server/run-profile.js'

export interface ResumePendingOptions {
  pendingStore: PendingStore
  runStore: RunStore
  abortRegistry: Map<string, AbortController>
  resolveProfile: (name: string) => Profile | null
  channels?: ChannelRuntime
  events?: AgentLoopEvents
  protocolVersion?: number
  /** Called only after the durable pending record accepts the answer. */
  onAccepted?: (pending: PendingInput) => void
  /** Rebuild context-bound runtime capabilities for a legitimate continuation. */
  runProfileOptions?: (pending: PendingInput, profile: Profile) => Partial<Pick<RunProfileOptions, 'runtimeTools' | 'runtimeToolAllowlist' | 'denyMutatingTools' | 'systemPromptAppend'>>
}

export type ResumePendingResult =
  | { status: 'ignored'; reason: string }
  | { status: 'waiting_input'; pending_id: string; run_id: string; session_id?: string }
  | { status: 'completed'; run_id: string; session_id: string; finalText: string }
  | { status: 'failed'; run_id: string; error: string }

export async function resumePendingInput(
  pendingId: string,
  answer: string,
  answeredVia: PendingAnsweredVia,
  opts: ResumePendingOptions,
): Promise<ResumePendingResult> {
  const existing = opts.pendingStore.get(pendingId)
  if (!existing || existing.state !== 'open') return { status: 'ignored', reason: 'pending input is not open' }

  // Verify ownership and resumability before changing the durable question.
  // Otherwise a stale or cross-scope request could consume a question that
  // can no longer be resumed.
  const target = opts.runStore.get(existing.run_id)
  if (!target || target.status !== 'waiting_input' || target.user !== existing.user || target.session_id !== existing.session_id || target.profile !== existing.profile) {
    return { status: 'ignored', reason: 'run is not waiting for input' }
  }
  if (!opts.resolveProfile(target.profile) || !loadSession(target.user, existing.session_id)) {
    return { status: 'ignored', reason: 'pending input target is unavailable' }
  }

  const pending = opts.pendingStore.answer(pendingId, answer, answeredVia)
  if (!pending || pending.state !== 'answered') return { status: 'ignored', reason: 'pending input could not be answered' }
  opts.onAccepted?.(pending)

  return continuePendingRun(pending, answer, opts)
}

export async function resumeExpiredInput(pendingId: string, opts: ResumePendingOptions): Promise<ResumePendingResult> {
  const pending = opts.pendingStore.get(pendingId)
  if (!pending || pending.state !== 'expired') return { status: 'ignored', reason: 'pending input is not expired' }
  return continuePendingRun(pending, expiredAnswer(pending), opts)
}

export async function resumeCancelledInput(pendingId: string, opts: ResumePendingOptions): Promise<ResumePendingResult> {
  const pending = opts.pendingStore.get(pendingId)
  if (!pending || pending.state !== 'cancelled') return { status: 'ignored', reason: 'pending input is not cancelled' }
  return continuePendingRun(pending, '[question cancelled — proceed without it or stop]', opts)
}

async function continuePendingRun(
  pending: PendingInput,
  answer: string,
  opts: ResumePendingOptions,
): Promise<ResumePendingResult> {
  const run = opts.runStore.get(pending.run_id)
  if (!run || run.status !== 'waiting_input') return { status: 'ignored', reason: 'run is not waiting for input' }
  if (run.user !== pending.user || run.session_id !== pending.session_id || run.profile !== pending.profile) {
    return { status: 'ignored', reason: 'pending input scope does not match run' }
  }
  if (!pending.tool_call_id) return { status: 'failed', run_id: pending.run_id, error: 'pending input has no tool call id' }

  const profile = opts.resolveProfile(run.profile)
  const session = loadSession(run.user, pending.session_id)
  if (!profile) return failRun(run.id, opts, 'profile not found on resume')
  if (!session) return failRun(run.id, opts, 'session not found on resume')

  const abort = new AbortController()
  opts.abortRegistry.set(run.id, abort)
  opts.runStore.update(run.id, { status: 'running', error: undefined })

  try {
    const result = await runProfileOnce({
      profile,
      userId: run.user,
      userMessage: '',
      events: opts.events ?? silentChannelEvents(opts.channels, run.user),
      signal: abort.signal,
      channels: opts.channels,
      runId: run.id,
      pendingInputs: opts.pendingStore,
      session,
      unattended: true,
      resume: pending.purpose === 'approval' ? undefined : { toolCallId: pending.tool_call_id, answer },
      resumeApproval: pending.purpose === 'approval'
        ? {
            toolCallId: pending.tool_call_id,
            approved: answer === 'allow' || answer === 'always' || answer === '1' || answer.toLowerCase() === 'allow' || answer.toLowerCase() === 'always',
            name: pending.tool_name ?? 'unknown',
            input: pending.tool_input ?? {},
            isMcp: pending.is_mcp ?? false,
          }
        : undefined,
      appendUser: false,
      protocolVersion: opts.protocolVersion,
      ...opts.runProfileOptions?.(pending, profile),
    })
    saveSession(result.session)
    const current = opts.runStore.get(run.id)
    if (!current || current.status !== 'running') {
      return { status: 'ignored', reason: `run was ${current?.status ?? 'removed'} during resume` }
    }
    opts.runStore.update(run.id, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
    return { status: 'completed', run_id: run.id, session_id: result.session.id, finalText: result.finalText }
  } catch (error: any) {
    if (isParkSignal(error)) {
      const current = opts.runStore.get(run.id)
      if (current?.status === 'cancelled') return { status: 'ignored', reason: 'run was cancelled during resume' }
      opts.runStore.update(run.id, { status: 'waiting_input', session_id: error.sessionId })
      return { status: 'waiting_input', pending_id: error.pendingId, run_id: run.id, session_id: error.sessionId }
    }
    const current = opts.runStore.get(run.id)
    if (current?.status === 'cancelled') return { status: 'ignored', reason: 'run was cancelled during resume' }
    return failRun(run.id, opts, error.message)
  } finally {
    opts.abortRegistry.delete(run.id)
  }
}

function failRun(runId: string, opts: ResumePendingOptions, error: string): ResumePendingResult {
  opts.runStore.update(runId, { status: 'failed', error, finished_at: new Date().toISOString() })
  return { status: 'failed', run_id: runId, error }
}

function silentChannelEvents(channels: ChannelRuntime | undefined, user: string): AgentLoopEvents {
  return {
    onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onSessionEnd: () => {}, onStats: () => {},
    onToolPrompt: (_id, name, input, risk, reason) => channels?.requestApproval(user, name, input, risk, reason) ?? Promise.resolve(false),
    onInputRequest: (_id, prompt, kind, options) => channels?.requestInput(user, prompt, kind, options).then(value => value ?? '') ?? Promise.resolve('[input unavailable]'),
  }
}

export function expiredAnswer(pending: PendingInput): string {
  const ttlMs = new Date(pending.expires_at).getTime() - new Date(pending.created_at).getTime()
  const ttl = ttlMs >= 86_400_000
    ? `${Math.round(ttlMs / 86_400_000)}d`
    : ttlMs >= 3_600_000
      ? `${Math.round(ttlMs / 3_600_000)}h`
      : `${Math.round(ttlMs / 60_000)}m`
  return `[no answer within ${ttl} — proceed without it or stop]`
}
