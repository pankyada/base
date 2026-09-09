import { describe, expect, it } from 'vitest'
import { buildScopedUrl, isStaleScope, scopeKey } from '../lib/scopedRequest'

describe('buildScopedUrl', () => {
  it('two identities produce different URLs', () => {
    const a = buildScopedUrl('http://localhost:7337', '/runs', { userId: 'user-a' })
    const b = buildScopedUrl('http://localhost:7337', '/runs', { userId: 'user-b' })
    expect(a).not.toBe(b)
    expect(a).toContain('user=user-a')
    expect(b).toContain('user=user-b')
  })

  it('includes profile where the route accepts it', () => {
    const url = buildScopedUrl('http://localhost:7337', '/runs', { userId: 'user-a', profile: 'coding' })
    expect(url).toContain('user=user-a')
    expect(url).toContain('profile=coding')
  })

  it('omits scope params entirely when scope is empty (Core default fallback)', () => {
    const url = buildScopedUrl('http://localhost:7337', '/pending', {})
    expect(url).toBe('http://localhost:7337/pending')
  })

  it('merges extra route params alongside scope', () => {
    const url = buildScopedUrl('http://localhost:7337', '/audit', { userId: 'user-a' }, { tool: 'bash', tainted: undefined })
    expect(url).toContain('user=user-a')
    expect(url).toContain('tool=bash')
    expect(url).not.toContain('tainted')
  })

  it('encodes special characters in scope values', () => {
    const url = buildScopedUrl('http://localhost:7337', '/usage', { userId: 'a b/c' })
    expect(url).toContain('user=a+b%2Fc')
  })
})

describe('scope staleness', () => {
  it('a superseded-scope response is rejected', () => {
    const requestedAt = { userId: 'user-a', profile: 'coding' }
    const nowActive = { userId: 'user-b', profile: 'coding' }
    expect(isStaleScope(requestedAt, nowActive)).toBe(true)
  })

  it('a response matching the still-active scope is accepted', () => {
    const requestedAt = { userId: 'user-a', profile: 'coding' }
    const nowActive = { userId: 'user-a', profile: 'coding' }
    expect(isStaleScope(requestedAt, nowActive)).toBe(false)
  })

  it('scopeKey distinguishes profile-only changes', () => {
    expect(scopeKey({ userId: 'user-a', profile: 'coding' })).not.toBe(scopeKey({ userId: 'user-a', profile: 'data' }))
  })

  it('scopeKey does not collide when a field value contains the delimiter', () => {
    // A space-joined key would make {userId:"a b"} indistinguishable from {userId:"a",profile:"b"}.
    expect(scopeKey({ userId: 'a b' })).not.toBe(scopeKey({ userId: 'a', profile: 'b' }))
  })
})

describe('aggregate routes stay unscoped', () => {
  // src/server/read-api.ts: /stats/routing takes no user or profile filter at all; /metrics accepts a
  // profile filter only (no `user`). Callers (app/ops/page.tsx, app/home/page.tsx) must not force a user
  // scope onto these — that would silently claim per-user data Core does not actually filter.
  it('/stats/routing carries no scope params', () => {
    const url = buildScopedUrl('http://localhost:7337', '/stats/routing', {})
    expect(url).toBe('http://localhost:7337/stats/routing')
  })

  it('/metrics carries only the profile filter, never a user filter', () => {
    const url = buildScopedUrl('http://localhost:7337', '/metrics', { profile: 'coding' })
    expect(url).toContain('profile=coding')
    expect(url).not.toContain('user=')
  })
})
