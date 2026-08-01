import type { Profile } from '../profiles/schema.js'
import { ensureContextState, type Session } from '../session/types.js'
import { contextWindowFor } from './estimator.js'
import { estimateTokens } from './estimator.js'

function renderPinList(pins: Array<{ key: string; text: string }>): string {
  if (pins.length === 0) return ''
  return `[Pinned context]\n\n${pins.map(pin => `[${pin.key}]\n${pin.text}`).join('\n\n')}`
}

export function pin(session: Session, profile: Profile, key: string, text: string): 'ok' | 'over-budget' {
  const state = ensureContextState(session)
  if (state.pins.some(existing => existing.key === key)) return 'ok'

  const candidate = [...state.pins, { key, text }]
  const prefixTokens = estimateTokens([{ role: 'system', content: renderPinList(candidate) }])
  const budget = contextWindowFor(profile) * (profile.context?.pin_budget ?? 0.25)
  if (prefixTokens > budget) return 'over-budget'

  state.pins.push({ key, text })
  return 'ok'
}

export function renderPins(session: Session): string {
  return renderPinList(ensureContextState(session).pins)
}
