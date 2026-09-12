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
export async function fetchRemote<T>(url: string, isEmpty: (data: T) => boolean = defaultIsEmpty as (data: T) => boolean, options?: RequestInit): Promise<RemoteData<T>> {
  let response: Response
  try {
    response = await (options ? fetch(url, options) : fetch(url))
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
 * Scope-aware `fetchRemote`. Two scope concepts are deliberately kept apart here:
 *
 * - `ambientScope` — the full active identity/profile in effect when the request was issued.
 * - `urlScope` — which scope params this particular route's URL should actually carry (e.g. `/pending`
 *   takes `user` only, never `profile`). Defaults to `ambientScope` for routes that take every field.
 *
 * Staleness is judged only over the fields present as keys in `urlScope` — i.e. the fields this route's
 * result actually depends on — comparing `ambientScope` (captured at request time) against
 * `currentScope()` (read once the response lands) restricted to those keys. A route whose URL omits a
 * field (e.g. `/pending` never sends `profile`) must not go stale just because that field changes or
 * arrives on the ambient scope later: the route's result never depended on it. A route whose URL does
 * carry a field (the common case, `urlScope` defaulting to the full `ambientScope`) still discards on a
 * genuine change to that field, same as before.
 *
 * Before this split, a route with a narrower URL scope reused that SAME truncated object for the
 * staleness comparison against the full ambient scope. That compares apples (a scope literal missing
 * the `profile` key entirely) to oranges (the full ambient scope, `profile` included) — the comparison
 * was permanently true the instant `profile` arrived from the WS stream, even though the field the
 * route's URL actually used (`user`) never changed. That discarded every response forever and left the
 * panel stuck on "loading".
 *
 * If the operator switches identity/profile mid-flight, and that field is one the route's URL carries,
 * the result is discarded (`'stale'`) rather than applied — this is the same discard rule sprint C2
 * established in `useHarnessQuery`/`RunBoard`/`AuditTable`, just factored out so C4's read-state wrapper
 * composes with it instead of duplicating it.
 */
export async function fetchScopedRemote<T>(
  baseUrl: string,
  path: string,
  ambientScope: RequestScope,
  currentScope: () => RequestScope,
  options: {
    /** Scope fields this route's URL should actually carry, AND the fields staleness is judged over. Defaults to `ambientScope` for routes that take every field; pass a narrower object literal (e.g. `{ userId: ambientScope.userId }`, omitting the `profile` key entirely) for a route that omits one. */
    urlScope?: RequestScope
    extraParams?: Record<string, string | undefined>
    isEmpty?: (data: T) => boolean
  } = {},
): Promise<RemoteData<T> | 'stale'> {
  const { urlScope = ambientScope, extraParams = {}, isEmpty = defaultIsEmpty as (data: T) => boolean } = options
  const url = buildScopedUrl(baseUrl, path, urlScope, extraParams)
  const result = await fetchRemote<T>(url, isEmpty)
  const relevantKeys = Object.keys(urlScope) as (keyof RequestScope)[]
  const project = (scope: RequestScope): RequestScope => {
    const projected: RequestScope = {}
    for (const key of relevantKeys) projected[key] = scope[key]
    return projected
  }
  if (isStaleScope(project(ambientScope), project(currentScope()))) return 'stale'
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
