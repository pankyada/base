import { describe, expect, it } from 'vitest'
import { redact, sanitizeError } from '../../src/provider/auth/redact.js'

describe('Codex auth redaction', () => {
  it('removes token and login code canaries from errors and objects', () => {
    const message = sanitizeError(new Error('access_token=access-secret refresh_token=refresh-secret authorization_code=auth-secret code_verifier=verify-secret user_code=ABCD-EFGH'))
    expect(message).not.toMatch(/access-secret|refresh-secret|auth-secret|verify-secret|ABCD-EFGH/)
    expect(JSON.stringify(redact({ access_token: 'access-secret', nested: { refresh_token: 'refresh-secret' } }))).not.toMatch(/access-secret|refresh-secret/)
  })
})
