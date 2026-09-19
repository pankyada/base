import { describe, it, expect } from 'vitest'
import { sanitizeUserId, userPaths } from '../src/session/user-paths.js'
import { join } from 'path'
import { harnessStatePath } from '../src/config/state-paths.js'

describe('sanitizeUserId', () => {
  it('lowercases input', () => {
    expect(sanitizeUserId('Pankaj')).toBe('pankaj')
  })

  it('replaces unsafe chars with hyphens', () => {
    expect(sanitizeUserId('hello world!')).toBe('hello-world-')
  })

  it('collapses path traversal attempt', () => {
    const result = sanitizeUserId('../../etc')
    expect(result).not.toContain('..')
    expect(result).not.toContain('/')
  })

  it('returns "default" for empty string', () => {
    expect(sanitizeUserId('')).toBe('default')
  })

  it('truncates to 64 chars', () => {
    expect(sanitizeUserId('a'.repeat(100))).toHaveLength(64)
  })

  it('keeps valid chars unchanged', () => {
    expect(sanitizeUserId('pankaj-01_dev')).toBe('pankaj-01_dev')
  })
})

describe('userPaths', () => {
  it('returns correct sessionsDir', () => {
    const paths = userPaths('pankaj', '/tmp/artifacts')
    expect(paths.sessionsDir).toBe(harnessStatePath('sessions', 'pankaj'))
  })

  it('returns correct privateMemDir', () => {
    const paths = userPaths('pankaj', '/tmp/artifacts')
    expect(paths.privateMemDir).toBe('/tmp/artifacts/users/pankaj/memory')
  })

  it('returns correct usageFile', () => {
    const paths = userPaths('pankaj', '/tmp/artifacts')
    expect(paths.usageFile).toBe(harnessStatePath('usage', 'pankaj.json'))
  })

  it('sanitizes user id inside userPaths', () => {
    const paths = userPaths('BAD USER', '/tmp/artifacts')
    expect(paths.sessionsDir).toContain('bad-user')
    expect(paths.sessionsDir).not.toContain('BAD')
  })
})
