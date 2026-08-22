import { describe, expect, it } from 'vitest'
import { approvalSummary, requiresDangerConfirmation } from '../components/ops/ApprovalQueue'
import { previewToolInput } from '../components/ApprovalModal'

describe('approval queue', () => {
  it('keeps risk, reason, and provenance gate visible', () => {
    expect(approvalSummary({ id: 'a', name: 'Bash', input: {}, risk: 'danger', reason: 'provenance gate: untrusted path' })).toContain('provenance gate')
  })

  it('requires an extra confirmation for danger actions', () => {
    expect(requiresDangerConfirmation('danger')).toBe(true)
    expect(requiresDangerConfirmation('safe')).toBe(false)
  })

  it('previews tool arguments with effect-specific fields', () => {
    expect(previewToolInput('Bash', { command: 'ls', cwd: '/tmp' })).toContain('cwd')
    expect(previewToolInput('Write', { path: 'a.txt', content: 'x' })).toContain('a.txt')
  })
})
