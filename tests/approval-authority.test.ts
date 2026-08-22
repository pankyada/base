import { describe, expect, it } from 'vitest'
import { isYoloEnabled, resolveApprovalLimit, resolveRequestedApprovalMode } from '../src/server/approval-mode.js'
import { ProfileSchema } from '../src/profiles/schema.js'
import { applyModeDefaults } from '../src/profiles/loader.js'
import { resolveAclDecision } from '../src/tools/acl.js'

describe('server-authoritative approval mode', () => {
  it('keeps a strict profile strict when hello asserts yolo', () => {
    const effective = resolveApprovalLimit({ approval_mode: 'strict' }, {})

    expect(effective).toBe('strict')
    expect(isYoloEnabled(effective)).toBe(false)
  })

  it('refuses a yolo request above the production ceiling', () => {
    const effective = resolveApprovalLimit({ approval_mode: 'yolo', mode: 'production' }, {})

    expect(resolveRequestedApprovalMode('yolo', effective)).toEqual({ ok: false, mode: effective })
  })

  it('accepts a permitted change for the approval_mode_changed echo', () => {
    const effective = resolveApprovalLimit({ approval_mode: 'danger' }, {})

    expect(resolveRequestedApprovalMode('strict', effective)).toEqual({ ok: true, mode: 'strict' })
  })

  it.each(['analyst', 'assistant', 'production'] as const)('caps %s mode at danger', mode => {
    expect(resolveApprovalLimit({ mode, approval_mode: 'yolo' }, {})).toBe('danger')
  })

  it('keeps trusted developer and mode-less profiles eligible for yolo', () => {
    expect(resolveApprovalLimit({ mode: 'developer', approval_mode: 'yolo' }, {})).toBe('yolo')
    expect(resolveApprovalLimit({ approval_mode: 'yolo' }, {})).toBe('yolo')
  })

  it('runs the assistant ACL path so denied Bash stays denied under the ceiling', () => {
    const profile = applyModeDefaults(ProfileSchema.parse({
      name: 'assistant', mode: 'assistant', approval_mode: 'yolo',
      model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
    }))
    const effective = resolveApprovalLimit(profile, {})
    expect(effective).toBe('danger')
    expect(resolveAclDecision('Bash', { command: 'echo unsafe' }, profile, effective).value).toBe('deny')
  })
})
