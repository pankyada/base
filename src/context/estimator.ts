import type { Profile } from '../profiles/schema.js'
import { listModels } from '../models/registry.js'
import type { Session } from '../session/types.js'
import { ensureContextState } from '../session/types.js'
import { codexCapability } from '../provider/codex/models.js'

const ALPHA = 0.3
const MIN_RATIO = 0.5
const MAX_RATIO = 3

export function rawTokens(messages: unknown[]): number {
  return Math.ceil(JSON.stringify(messages, (_key, value) => _key === 'providerState' ? undefined : value).length / 4)
}

export function estimateTokens(messages: unknown[], session?: Session): number {
  const raw = rawTokens(messages)
  const ratio = session?.context?.calib.samples ? session.context.calib.ratio : 1
  // Opaque provider state is not prompt text and must not train text calibration.
  // Reserve a conservative independent allowance for its bounded wire payload.
  const opaqueOverhead = messages.reduce<number>((sum, message) => {
    const state = message && typeof message === 'object' ? (message as Record<string, unknown>).providerState : undefined
    return sum + (state === undefined ? 0 : Math.ceil(Buffer.byteLength(JSON.stringify(state), 'utf8') / 4))
  }, 0)
  return Math.ceil(raw * ratio) + opaqueOverhead
}

export function calibrate(session: Session, actualPromptTokens: number, sentRaw: number): void {
  const state = ensureContextState(session)
  if (!Number.isFinite(actualPromptTokens) || actualPromptTokens <= 0 || !Number.isFinite(sentRaw) || sentRaw <= 0) return
  const observed = Math.max(MIN_RATIO, Math.min(MAX_RATIO, actualPromptTokens / sentRaw))
  state.calib.ratio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, state.calib.ratio + ALPHA * (observed - state.calib.ratio)))
  state.calib.samples += 1
}

export function contextWindowFor(profile: Profile): number {
  if (profile.model.auth === 'codex_oauth') {
    const cap = codexCapability(profile.model.id)
    if (!cap) throw new Error('Codex model context limit unknown')
    return Math.min(profile.context?.max_tokens ?? profile.context_window?.max_tokens ?? cap.contextWindow, cap.contextWindow)
  }
  if (profile.context?.max_tokens) return profile.context.max_tokens
  if (profile.context_window?.max_tokens) return profile.context_window.max_tokens
  const registered = listModels(profile).find(model => model.id === profile.model.id)?.context_window
  return registered && registered > 0 ? registered : Infinity
}
