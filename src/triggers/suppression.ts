const writes = new Map<string, number>()

export function recordHarnessWrite(path: string): void { writes.set(path, Date.now()) }

export function recentlyWritten(path: string, withinMs: number): boolean {
  const at = writes.get(path)
  if (!at) return false
  if (Date.now() - at <= withinMs) return true
  writes.delete(path)
  return false
}
