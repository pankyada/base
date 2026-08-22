import { describe, expect, it } from 'vitest'
import { applyModeDefaults } from '../src/profiles/loader.js'
import { ProfileSchema } from '../src/profiles/schema.js'
import { resolveAclDecision } from '../src/tools/acl.js'
import { SessionApprovalGrants } from '../src/server/session-approvals.js'

describe('session-scoped always-allow grants', () => {
  it('auto-approves remembered prompt tools with an explicit session grant', () => {
    const grants = new SessionApprovalGrants()
    grants.remember('Read', 'prompt')
    expect(grants.check('Read', 'prompt')).toEqual({ name: 'Read', scope: 'session' })
    expect(grants.check('Bash', 'prompt')).toBeUndefined()
  })

  it('deny ACL cannot be widened by an always-allow grant', () => {
    const profile = applyModeDefaults(ProfileSchema.parse({
      name: 'assistant', mode: 'assistant', approval_mode: 'yolo',
      model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
    }))
    const decision = resolveAclDecision('Bash', { command: 'echo unsafe' }, profile, 'danger').value
    const grants = new SessionApprovalGrants()
    grants.remember('Bash', decision)
    expect(decision).toBe('deny')
    expect(grants.check('Bash', decision)).toBeUndefined()
  })

  it('cancel clears session grants', () => {
    const grants = new SessionApprovalGrants()
    grants.remember('Read', 'prompt')
    grants.clear()
    expect(grants.check('Read', 'prompt')).toBeUndefined()
  })
})
