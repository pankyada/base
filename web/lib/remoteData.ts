// Shared read-state helper (sprint C4 / PT-006). Every remote read in this repo used to collapse
// three distinct outcomes -- still loading, genuinely empty, and unreachable -- into one: a `catch`
// (or a non-ok response mapped to `{}`/`[]` before the catch ever ran) that produced the same empty
// value as a real empty result. An operator staring at "0 pending" during a backend outage could not
// tell "nothing outstanding" from "not talking to the server." This module is the one place that
// tells those apart, so every surface renders the same three states instead of re-deriving them.
import { buildScopedUrl, isStaleScope, type RequestScope } from './scopedRequest'

export type RemoteData<T> =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | { status: 'empty' }
  | { status: 'ready'; data: T }

export const loadingRemote = <T>(): RemoteData<T> => ({ status: 'loading' })
export const failedRemote = <T>(reason: string): RemoteData<T> => ({ status: 'failed', reason })

/** Default emptiness check: an array with no items, or an object with no own keys. Anything else (including primitives) counts as data. */
export function defaultIsEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0
  return false
}

/**
 * Fetch `url`, parse it as JSON, and classify the outcome. A rejected fetch (network failure) and a
 * non-ok HTTP response are BOTH failures -- the caller must never substitute an empty collection for
 * either. Only a successful, parseable body is eligible to be `empty` or `ready`.
 */
export async function fetchRemote<T>(url: string, isEmpty: (data: T) => boolean = defaultIsEmpty as (data: T) => boolean): Promise<RemoteData<T>> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (cause) {
    return failedRemote(cause instanceof Error ? cause.message : 'network request failed')
  }
  if (!response.ok) return failedRemote(`request failed (${response.status})`)
  let data: T
  try {
    data = (await response.json()) as T
  } catch {
    return failedRemote(`invalid response body (${response.status})`)
  }
  return isEmpty(data) ? { status: 'empty' } : { status: 'ready', data }
}

/**
 * Scope-aware `fetchRemote`: builds the URL from the active identity/profile and, once the response
 * lands, checks whether the scope that issued the request is still current. If the operator switched
 * identity/profile mid-flight the result is discarded (`'stale'`) rather than applied — this is the
 * same discard rule sprint C2 established in `useHarnessQuery`/`RunBoard`/`AuditTable`, just factored
 * out so C4's read-state wrapper composes with it instead of duplicating it.
 */
export async function fetchScopedRemote<T>(
  baseUrl: string,
  path: string,
  requestedScope: RequestScope,
  currentScope: () => RequestScope,
  extraParams: Record<string, string | undefined> = {},
  isEmpty: (data: T) => boolean = defaultIsEmpty as (data: T) => boolean,
): Promise<RemoteData<T> | 'stale'> {
  const url = buildScopedUrl(baseUrl, path, requestedScope, extraParams)
  const result = await fetchRemote<T>(url, isEmpty)
  if (isStaleScope(requestedScope, currentScope())) return 'stale'
  return result
}

/**
 * Run several named reads and report each one's outcome independently -- `Promise.allSettled` so one
 * dead endpoint cannot blank the others. Every part function is expected to already return a
 * `RemoteData<T>` (i.e. it should not throw for an ordinary fetch failure — `fetchRemote` already
 * turns those into `failed`); the `allSettled` wrapping is a backstop for a part that throws
 * synchronously or rejects for some other reason, so it still surfaces as that part's `failed` state
 * rather than rejecting the whole batch.
 */
export async function fetchBatch<T extends Record<string, unknown>>(
  parts: { [K in keyof T]: () => Promise<RemoteData<T[K]>> },
): Promise<{ [K in keyof T]: RemoteData<T[K]> }> {
  const keys = Object.keys(parts) as (keyof T)[]
  const settled = await Promise.allSettled(keys.map(key => parts[key]()))
  const result = {} as { [K in keyof T]: RemoteData<T[K]> }
  keys.forEach((key, index) => {
    const outcome = settled[index]
    result[key] = outcome.status === 'fulfilled' ? outcome.value : failedRemote(outcome.reason instanceof Error ? outcome.reason.message : 'request failed')
  })
  return result
}

/** True when a batch has at least one failed part -- used to decide whether to show a combined unavailable notice. */
export function batchHasFailure<T extends Record<string, unknown>>(batch: { [K in keyof T]: RemoteData<T[K]> }): boolean {
  return Object.values(batch).some(part => (part as RemoteData<unknown>).status === 'failed')
}

/** Parts of a named batch that failed, as "<key>: <reason>" — used to render one combined unavailable notice instead of one per part. */
export function batchFailureReasons<T extends Record<string, unknown>>(batch: { [K in keyof T]: RemoteData<T[K]> }): string[] {
  return (Object.keys(batch) as (keyof T)[]).map(key => { const part = batch[key] as RemoteData<unknown>; return part.status === 'failed' ? `${String(key)}: ${part.reason}` : undefined }).filter((line): line is string => Boolean(line))
}

/** Convenience accessor: the `data` a `ready` result carries, or `fallback` for every other state (including `empty`). Callers that just need "the list, or []" without caring about the distinction use this; callers that must render the three states separately should switch on `.status` directly. */
export function remoteOr<T>(remote: RemoteData<T>, fallback: T): T {
  return remote.status === 'ready' ? remote.data : fallback
}
