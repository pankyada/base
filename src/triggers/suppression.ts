import { resolve } from 'path'

const writes = new Map<string, number>()

export function recordHarnessWrite(path: string): void { writes.set(resolve(path), Date.now()) }

export function recentlyWritten(path: string, withinMs: number): boolean {
  const normalized = resolve(path)
  const at = writes.get(normalized)
  if (!at) return false
  if (Date.now() - at <= withinMs) return true
  writes.delete(normalized)
  return false
}
