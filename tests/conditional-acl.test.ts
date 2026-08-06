import { describe, expect, it } from 'vitest'
import { resolveAclDecision } from '../src/tools/acl.js'
import { matchesPredicate } from '../src/tools/predicates.js'

const profile: any = {
  tools: { builtin: {
    Notify: { default: 'prompt', allow_if: [{ arg: 'channel', in_list: 'trusted' }] },
    Write: { default: 'prompt', deny_if: [{ arg: 'path', matches: '**/*.secret' }] },
  }, custom: {}, mcp_servers: [] },
  lists: { trusted: ['phone'] },
}

describe('conditional ACL', () => {
  it('allows only matching allow_if and deny_if wins', () => {
    expect(resolveAclDecision('Notify', { channel: 'phone' }, profile).value).toBe('allow')
    expect(resolveAclDecision('Notify', { channel: 'email' }, profile).value).toBe('prompt')
    expect(resolveAclDecision('Write', { path: 'keys.secret' }, profile).value).toBe('deny')
  })

  it('fails closed on malformed predicate and missing arguments', () => {
    expect(() => matchesPredicate({ arg: 'x' } as any, {}, {})).toThrow('exactly one')
    expect(matchesPredicate({ arg: 'missing', equals: 'yes' }, {}, {})).toBe(false)
  })
})
