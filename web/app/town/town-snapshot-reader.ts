export interface ScopedSnapshotReaderOptions<T> {
  scopeKey: string
  fetchSnapshot: (signal: AbortSignal) => Promise<T>
  cursorOf: (snapshot: T) => number
  onSnapshot: (snapshot: T) => void
  onError: (error: string) => void
}

/**
 * Reads one Town scope at a time. Disposal aborts active transport and fences
 * late successes/errors even when the fetch implementation ignores abort.
 */
export function createScopedSnapshotReader<T>(options: ScopedSnapshotReaderOptions<T>): {
  refresh(): Promise<void>
  dispose(): void
} {
  let disposed = false
  let generation = 0
  let cursor = -1
  let activeController: AbortController | undefined
  let inFlight: Promise<void> | undefined
  let refreshQueued = false

  const current = (requestGeneration: number, controller: AbortController) =>
    !disposed && !controller.signal.aborted && generation === requestGeneration

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (inFlight) {
      refreshQueued = true
      return inFlight
    }

    const requestGeneration = ++generation
    const controller = new AbortController()
    activeController = controller
    let request!: Promise<void>
    request = (async () => {
      try {
        const snapshot = await options.fetchSnapshot(controller.signal)
        if (!current(requestGeneration, controller)) return
        const nextCursor = options.cursorOf(snapshot)
        if (!Number.isFinite(nextCursor) || nextCursor < cursor) return
        cursor = nextCursor
        options.onSnapshot(snapshot)
      } catch (error) {
        if (!current(requestGeneration, controller)) return
        options.onError(error instanceof Error ? error.message : String(error))
      } finally {
        if (activeController === controller) activeController = undefined
        if (inFlight === request) inFlight = undefined
        if (!disposed && refreshQueued) {
          refreshQueued = false
          queueMicrotask(() => { void refresh() })
        }
      }
    })()
    inFlight = request
    return request
  }

  return {
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      refreshQueued = false
      activeController?.abort()
      activeController = undefined
    },
  }
}
