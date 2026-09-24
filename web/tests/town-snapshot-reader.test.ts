import { describe, expect, it, vi } from 'vitest'
import { createScopedSnapshotReader } from '../app/town/town-snapshot-reader'

type Snapshot = { cursor: number; scope: string }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('scoped Town snapshot reader', () => {
  it('fences a late old-scope success after disposing the reader', async () => {
    const oldRequest = deferred<Snapshot>()
    const visible: Snapshot[] = []
    const oldFetch = vi.fn((_signal: AbortSignal) => oldRequest.promise)
    const oldReader = createScopedSnapshotReader({ scopeKey: 'user-a:coding', fetchSnapshot: oldFetch, cursorOf: item => item.cursor, onSnapshot: item => visible.push(item), onError: () => { throw new Error('old scope error must be ignored') } })
    const oldRead = oldReader.refresh()

    oldReader.dispose()
    expect(oldFetch.mock.calls[0]?.[0].aborted).toBe(true)
    const nextReader = createScopedSnapshotReader({ scopeKey: 'user-b:coding', fetchSnapshot: async () => ({ cursor: 2, scope: 'user-b' }), cursorOf: item => item.cursor, onSnapshot: item => visible.push(item), onError: () => undefined })
    await nextReader.refresh()
    oldRequest.resolve({ cursor: 99, scope: 'user-a' })
    await oldRead

    expect(visible).toEqual([{ cursor: 2, scope: 'user-b' }])
    nextReader.dispose()
  })

  it('ignores a late error from a disposed scope', async () => {
    const oldRequest = deferred<Snapshot>()
    const onError = vi.fn()
    const reader = createScopedSnapshotReader({ scopeKey: 'old', fetchSnapshot: () => oldRequest.promise, cursorOf: item => item.cursor, onSnapshot: () => undefined, onError })
    const read = reader.refresh()
    reader.dispose()
    oldRequest.reject(new Error('old transport failed'))
    await read
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps cursors monotonic and coalesces refreshes during an active request', async () => {
    const responses = [deferred<Snapshot>(), deferred<Snapshot>()]
    let calls = 0
    const accepted: Snapshot[] = []
    const reader = createScopedSnapshotReader({
      scopeKey: 'user:coding',
      fetchSnapshot: () => responses[calls++]!.promise,
      cursorOf: item => item.cursor,
      onSnapshot: item => accepted.push(item),
      onError: () => undefined,
    })

    const first = reader.refresh()
    void reader.refresh()
    void reader.refresh()
    expect(calls).toBe(1)
    responses[0]!.resolve({ cursor: 8, scope: 'first' })
    await first
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(2)
    responses[1]!.resolve({ cursor: 7, scope: 'stale' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(accepted).toEqual([{ cursor: 8, scope: 'first' }])
    reader.dispose()
  })
})
