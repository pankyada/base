import { describe, expect, it } from 'vitest'
import { auditUrl } from '../components/ops/AuditTable'

describe('audit table', () => {
  it('pushes filters to the server including tainted turns', () => {
    expect(auditUrl('http://localhost:7337', { tainted: true, tool: 'Bash' })).toContain('tainted=true')
    expect(auditUrl('http://localhost:7337', { tainted: true, tool: 'Bash' })).toContain('tool=Bash')
  })

  it('scopes reads to the active identity and profile', () => {
    const url = auditUrl('http://localhost:7337', {}, { userId: 'user-a', profile: 'coding' })
    expect(url).toContain('user=user-a')
    expect(url).toContain('profile=coding')
  })

  it('two identities produce different audit URLs', () => {
    expect(auditUrl('http://localhost:7337', {}, { userId: 'user-a' })).not.toBe(auditUrl('http://localhost:7337', {}, { userId: 'user-b' }))
  })
})
