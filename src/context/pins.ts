import type { Profile } from '../profiles/schema.js'
import { ensureContextState, type Session } from '../session/types.js'
import { contextWindowFor } from './estimator.js'
import { estimateTokens } from './estimator.js'

function renderPinList(pins: Array<{ key: string; text: string }>): string {
  if (pins.length === 0) return ''
  return `[Pinned context]\n\n${pins.map(pin => `[${pin.key}]\n${pin.text}`).join('\n\n')}`
}

function pinBudget(profile: Profile): number {
  return contextWindowFor(profile) * (profile.context?.pin_budget ?? 0.25)
}

function allPins(state: ReturnType<typeof ensureContextState>): Array<{ key: string; text: string }> {
  return [...state.pins, ...(state.supplemental_pins ?? [])]
}

export function clearSupplementalPins(session: Session): void {
  ensureContextState(session).supplemental_pins = []
}

export function addSupplementalPin(session: Session, profile: Profile, pinValue: { key: string; text: string; source_revision: string }): 'ok' | 'over-budget' {
  const state = ensureContextState(session)
  state.supplemental_pins ??= []
  if (state.supplemental_pins.some(existing => existing.key === pinValue.key)) return 'ok'
  const candidate = [...allPins(state), pinValue]
  if (estimateTokens([{ role: 'system', content: renderPinList(candidate) }]) > pinBudget(profile)) return 'over-budget'
  state.supplemental_pins.push({ ...pinValue, created_at: new Date().toISOString() })
  return 'ok'
}

export function pin(session: Session, profile: Profile, key: string, text: string): 'ok' | 'over-budget' {
  const state = ensureContextState(session)
  if (state.pins.some(existing => existing.key === key)) return 'ok'

  const candidate = [...state.pins, { key, text }, ...(state.supplemental_pins ?? [])]
  const prefixTokens = estimateTokens([{ role: 'system', content: renderPinList(candidate) }])
  const budget = pinBudget(profile)
  if (prefixTokens > budget) {
    // Explicit pins are authoritative. Evict supplemental pins from newest to oldest
    // until the explicit set fits, while never evicting another explicit pin.
    const supplements = [...(state.supplemental_pins ?? [])]
    while (supplements.length > 0 && estimateTokens([{ role: 'system', content: renderPinList([...state.pins, { key, text }, ...supplements]) }]) > budget) supplements.pop()
    if (estimateTokens([{ role: 'system', content: renderPinList([...state.pins, { key, text }, ...supplements]) }]) > budget) return 'over-budget'
    state.supplemental_pins = supplements
  }

  state.pins.push({ key, text })
  return 'ok'
}

export function renderPins(session: Session): string {
  const state = ensureContextState(session)
  return renderPinList(allPins(state))
}
