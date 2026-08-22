import { describe, expect, it } from 'vitest'
import { auditUrl } from '../components/ops/AuditTable'

describe('audit table', () => {
  it('pushes filters to the server including tainted turns', () => {
    expect(auditUrl('http://localhost:7337', { tainted: true, tool: 'Bash' })).toContain('tainted=true')
    expect(auditUrl('http://localhost:7337', { tainted: true, tool: 'Bash' })).toContain('tool=Bash')
  })
})
