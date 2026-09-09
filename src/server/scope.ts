import { sanitizeUserId } from '../session/user-paths.js'

/** Bounded request-scope error used by REST and WS entry points. */
export class ScopeError extends Error {
  readonly status = 400
  constructor(message = 'invalid user scope') { super(message) }
}

/**
 * Normalize caller-asserted scope without turning malformed values into a
 * different user. Omitted scope keeps the caller's documented fallback.
 */
export function normalizeUserScope(value: unknown, fallback = 'anonymous'): string {
  if (value === undefined || value === null) return sanitizeUserId(fallback)
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new ScopeError('invalid user scope')
  return sanitizeUserId(value)
}

export function assertMatchingScopes(query: unknown, body: unknown): string | undefined {
  if (query === undefined && body === undefined) return undefined
  const queryScope = query === undefined ? undefined : normalizeUserScope(query)
  const bodyScope = body === undefined ? undefined : normalizeUserScope(body)
  if (queryScope && bodyScope && queryScope !== bodyScope) throw new ScopeError('contradictory user scope')
  return queryScope ?? bodyScope
}
