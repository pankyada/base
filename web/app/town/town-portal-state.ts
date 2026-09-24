export interface ObservatoryReturnView {
  userId: string
  profile: string
  position: [number, number, number]
  target: [number, number, number]
}

export function observatoryReturnKey(userId: string, profile: string | undefined): string {
  return `base.town.observatory-return.v1:${encodeURIComponent(JSON.stringify([userId, profile ?? '']))}`
}

export function serializeObservatoryReturnView(view: ObservatoryReturnView): string {
  return JSON.stringify({ version: 1, ...view })
}

export function parseObservatoryReturnView(value: string | null, userId: string, profile: string | undefined): ObservatoryReturnView | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<ObservatoryReturnView> & { version?: unknown }
    const vector = (input: unknown): input is [number, number, number] => Array.isArray(input) && input.length === 3 && input.every(n => typeof n === 'number' && Number.isFinite(n))
    if (candidate.version !== 1 || candidate.userId !== userId || candidate.profile !== (profile ?? '') || !vector(candidate.position) || !vector(candidate.target)) return null
    if (Math.hypot(...candidate.position) > 100_000 || Math.hypot(...candidate.target) > 100_000) return null
    return { userId, profile: profile ?? '', position: candidate.position, target: candidate.target }
  } catch {
    return null
  }
}

export function readObservatoryReturnView(storage: Pick<Storage, 'getItem'>, userId: string, profile: string | undefined): ObservatoryReturnView | null {
  try { return parseObservatoryReturnView(storage.getItem(observatoryReturnKey(userId, profile)), userId, profile) } catch { return null }
}

export function writeObservatoryReturnView(storage: Pick<Storage, 'setItem'>, view: ObservatoryReturnView): void {
  try { storage.setItem(observatoryReturnKey(view.userId, view.profile), serializeObservatoryReturnView(view)) } catch { /* Storage can be disabled or full. */ }
}

export function removeObservatoryReturnView(storage: Pick<Storage, 'removeItem'>, userId: string, profile: string | undefined): void {
  try { storage.removeItem(observatoryReturnKey(userId, profile)) } catch { /* Storage can be disabled. */ }
}
