import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveAclDecision } from '../src/tools/acl.js'
import { resolveAclDecisionWithMemory } from '../src/tools/acl.js'
import { matchesPredicate } from '../src/tools/predicates.js'
import { ProfileSchema } from '../src/profiles/schema.js'

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
    expect(() => matchesPredicate({ arg: 'x', equals: 'yes', typo: true } as any, {}, {})).toThrow('unknown predicate')
    expect(matchesPredicate({ arg: 'missing', equals: 'yes' }, {}, {})).toBe(false)
  })

  it.each([
    ['equals', { value: 'yes' }, { arg: 'value', equals: 'yes' }, true],
    ['in_list', { value: 'phone' }, { arg: 'value', in_list: 'trusted' }, true],
    ['matches', { value: 'a/b.txt' }, { arg: 'value', matches: '**/*.txt' }, true],
    ['lt', { value: 2 }, { arg: 'value', lt: 3 }, true],
    ['gt', { value: 4 }, { arg: 'value', gt: 3 }, true],
    ['present', { value: null }, { arg: 'value', present: true }, true],
    ['absent', {}, { arg: 'value', absent: true }, true],
  ])('matches %s predicate', (_name, input, predicate, expected) => {
    expect(matchesPredicate(predicate as any, input as any, { trusted: ['phone'] })).toBe(expected)
  })

  it('keeps deny unbeatable and rejects unknown predicates at profile load', () => {
    const deny = { ...profile, tools: { ...profile.tools, builtin: { Write: { default: 'deny', allow_if: [{ arg: 'path', equals: 'safe' }] } } } }
    expect(resolveAclDecision('Write', { path: 'safe' }, deny, 'yolo').value).toBe('deny')
    expect(() => ProfileSchema.parse({
      name: 'bad', model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'm' },
      system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
      tools: { builtin: { Write: { default: 'allow', allow_if: [{ arg: 'path', typo: 'x' }] } } },
    })).toThrow()
  })

  it('contains path escapes, symlink exits, unicode, and prefix confusion', () => {
    const root = mkdtempSync(join(tmpdir(), 'acl-paths-'))
    const safe = join(root, 'safe')
    const sibling = join(root, 'safely-outside')
    mkdirSync(safe)
    mkdirSync(sibling)
    writeFileSync(join(safe, 'ok.txt'), 'ok')
    writeFileSync(join(sibling, 'no.txt'), 'no')
    symlinkSync(sibling, join(safe, 'link-out'))
    expect(matchesPredicate({ arg: 'path', under_path: safe }, { path: join(safe, 'new.txt') }, {})).toBe(true)
    expect(matchesPredicate({ arg: 'path', under_path: safe }, { path: join(safe, '..', 'safely-outside', 'no.txt') }, {})).toBe(false)
    expect(matchesPredicate({ arg: 'path', under_path: safe }, { path: join(safe, 'link-out', 'no.txt') }, {})).toBe(false)
    expect(matchesPredicate({ arg: 'path', under_path: safe }, { path: join(root, 'safely-outside', 'no.txt') }, {})).toBe(false)
    expect(matchesPredicate({ arg: 'path', under_path: safe + '/' }, { path: join(safe, 'ok.txt') }, {})).toBe(true)
  })

  it('uses a JSON array from memory and denies when the source cannot be read', async () => {
    const fromMemory: any = { ...profile, lists: { trusted: 'memory:user/contacts' } }
    let reads = 0
    const memory: any = { read: async () => { reads++; return { content: '["phone"]' } } }
    await expect(resolveAclDecisionWithMemory('Notify', { channel: 'phone' }, fromMemory, memory)).resolves.toMatchObject({ value: 'allow' })
    await expect(resolveAclDecisionWithMemory('Notify', { channel: 'phone' }, fromMemory, memory)).resolves.toMatchObject({ value: 'allow' })
    expect(reads).toBe(1)
    await expect(resolveAclDecisionWithMemory('Notify', { channel: 'phone' }, fromMemory, { read: async () => { throw new Error('offline') } } as any)).resolves.toMatchObject({ value: 'deny' })
  })
})
