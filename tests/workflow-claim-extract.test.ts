import { describe, expect, it } from 'vitest'
import { buildClaimEvidence, claimRetryPointer, decideClaimGate, extractClaims, hasVerifyArtifact } from '../src/workflow/claims.js'
import type { Session, SessionToolCall } from '../src/session/types.js'

// Roadmap #31 phase 5 (PT-080), spec §5.7. Pure claim extraction, evidence
// assembly, and gate-policy tests — no I/O, no model calls. See
// tests/decisions-check-claims.test.ts for the Jev call layer and
// tests/workflow-claim-check-runtime.test.ts for the runWorkflow wiring.

function call(overrides: Partial<SessionToolCall> = {}): SessionToolCall {
  return { name: 'Read', input: {}, result: 'ok', ok: true, ts: new Date().toISOString(), ...overrides }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1', user: 'u', profile: 'coding', project: 'p', created_at: new Date().toISOString(),
    messages: [], tool_calls: [], usage: { input: 0, output: 0, cost_usd: 0 }, session_memory: {}, todos: [],
    ...overrides,
  }
}

describe('extractClaims', () => {
  it('keeps a sentence containing a number', () => {
    expect(extractClaims('The build ran 42 tests without incident today.')).toEqual(['The build ran 42 tests without incident today.'])
  })

  it('keeps a sentence containing a file-like path or name', () => {
    expect(extractClaims('Updated src/workflow/runner.ts to add the hook.')).toEqual(['Updated src/workflow/runner.ts to add the hook.'])
  })

  it('keeps a sentence containing an assertion verb', () => {
    expect(extractClaims('The suite passes without any known issue.')).toEqual(['The suite passes without any known issue.'])
  })

  it('drops noise with no number, path, or assertion verb', () => {
    expect(extractClaims('Just some vague chatter about nothing much.')).toEqual([])
  })

  it('drops pieces shorter than 12 chars even if they look checkable', () => {
    expect(extractClaims('42 ok. It is fine and good, truly.')).toEqual(['It is fine and good, truly.'])
  })

  it('caps at 8 claims, preferring earlier ones', () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `Claim number ${i} passes the check today.`)
    const claims = extractClaims(sentences.join(' '))
    expect(claims).toHaveLength(8)
    expect(claims[0]).toContain('Claim number 0')
    expect(claims[7]).toContain('Claim number 7')
  })

  it('dedupes identical claims (case-insensitive)', () => {
    const artifact = 'The file src/a.ts passes review. The file src/a.ts passes review.'
    expect(extractClaims(artifact)).toHaveLength(1)
  })

  it('is deterministic across repeated calls on the same input', () => {
    const artifact = '## Result\nThe change touches src/x.ts and adds 3 tests.\nIt returns the expected value.'
    expect(extractClaims(artifact)).toEqual(extractClaims(artifact))
  })

  it('returns empty for an empty artifact', () => {
    expect(extractClaims('')).toEqual([])
  })
})

describe('buildClaimEvidence', () => {
  it('returns undefined when there are no tool calls since toolCallsBefore', () => {
    const s = session({ tool_calls: [call()] })
    expect(buildClaimEvidence(s, 1)).toBeUndefined()
  })

  it('returns undefined for a session with zero tool calls', () => {
    expect(buildClaimEvidence(session(), 0)).toBeUndefined()
  })

  it('bounds each item to 1500 chars and returns newest first', () => {
    const s = session({
      tool_calls: [
        call({ name: 'Read', result: 'first' }),
        call({ name: 'Write', result: 'x'.repeat(2000) }),
      ],
    })
    const evidence = buildClaimEvidence(s, 0)
    expect(evidence).toBeDefined()
    expect(evidence!.items[0].tool).toBe('Write')
    expect(evidence!.items[0].result.length).toBe(1500)
    expect(evidence!.items[1].tool).toBe('Read')
  })

  it('bounds the total across items to 8000 chars', () => {
    const calls = Array.from({ length: 10 }, (_, i) => call({ name: `tool${i}`, result: 'y'.repeat(1500) }))
    const s = session({ tool_calls: calls })
    const evidence = buildClaimEvidence(s, 0)
    const total = evidence!.items.reduce((sum, item) => sum + item.result.length, 0)
    expect(total).toBeLessThanOrEqual(8000)
    expect(evidence!.items.length).toBeLessThan(10)
  })

  it('marks tainted true when the session has taint_sources', () => {
    const s = session({ tool_calls: [call()], taint_sources: ['untrusted-tool'] })
    expect(buildClaimEvidence(s, 0)!.tainted).toBe(true)
  })

  it('marks tainted false when the session has no taint_sources', () => {
    const s = session({ tool_calls: [call()] })
    expect(buildClaimEvidence(s, 0)!.tainted).toBe(false)
  })

  it('only considers calls from toolCallsBefore onward', () => {
    const s = session({ tool_calls: [call({ name: 'Old' }), call({ name: 'New' })] })
    const evidence = buildClaimEvidence(s, 1)
    expect(evidence!.items.map(i => i.tool)).toEqual(['New'])
  })
})

describe('decideClaimGate', () => {
  it('passes when every probability is >= 0.3', () => {
    expect(decideClaimGate([0.3, 0.5, 0.9])).toEqual({ verdict: 'pass', minP: 0.3 })
  })

  it('fails when any probability is < 0.3', () => {
    expect(decideClaimGate([0.9, 0.29, 0.5])).toEqual({ verdict: 'fail', minP: 0.29 })
  })
})

describe('claimRetryPointer', () => {
  it('points at the build stage when present', () => {
    expect(claimRetryPointer(['recon', 'plan', 'design', 'build', 'verify', 'review'])).toBe(3)
  })

  it('points at the stage before verify when there is no build stage', () => {
    expect(claimRetryPointer(['recon', 'plan', 'verify', 'review'])).toBe(1)
  })

  it('never points before recon (index 0) even with a degenerate playbook', () => {
    expect(claimRetryPointer(['recon', 'verify'])).toBe(0)
  })
})

describe('hasVerifyArtifact', () => {
  it('true when a verify artifact is present', () => {
    expect(hasVerifyArtifact([{ stage: 'recon', body: 'a' }, { stage: 'verify', body: 'b' }])).toBe(true)
  })

  it('false when no verify artifact is present', () => {
    expect(hasVerifyArtifact([{ stage: 'recon', body: 'a' }, { stage: 'build', body: 'b' }])).toBe(false)
  })
})
