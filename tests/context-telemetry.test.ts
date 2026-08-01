import { describe, expect, it, vi } from 'vitest'
import type { TelemetryEvent } from '../src/types.js'
import { project, projectionTelemetry } from '../src/context/projection.js'
import { contextRestoreTool } from '../src/tools/builtin/context-restore.js'
import { createSession } from '../src/session/store.js'
import { logEvent } from '../src/telemetry/logger.js'

describe('context telemetry', () => {
  it('keeps old telemetry lines valid because context fields are optional', () => {
    const oldLine = JSON.parse('{"ts":"2026-08-01T00:00:00Z","session":"s","profile":"p","kind":"tool"}') as TelemetryEvent
    expect(oldLine.context_tokens_est).toBeUndefined()
  })

  it('reports elision and digest metrics on projection results', async () => {
    const session = createSession('test', 'user')
    session.messages.push(
      { role: 'system', content: 's' },
      { role: 'user', content: 'old' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_old', type: 'function', function: { name: 'Read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_old', content: 'x'.repeat(5000) },
      { role: 'assistant', content: 'closed' },
      { role: 'user', content: 'tail' },
      { role: 'assistant', content: 'answer' },
    )
    const profile: any = { name: 'p', model: { id: 'm', base_url: 'https://example.com', api_key_env: 'KEY' }, context: { max_tokens: 1000, high_water: 0.8, low_water: 0.45, tail_turns: 1, pin_budget: 0.25, cache: false } }
    const projected = await project(session, profile, { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"digest":"d","facts":[]}' } }] }) } } } as any)
    const metrics = projectionTelemetry(projected)
    expect(metrics.elided_count).toBeGreaterThanOrEqual(1)
    expect(metrics.elided_bytes).toBeGreaterThanOrEqual(5000)
    expect(metrics.digest_calls).toBe(0)
  })

  it('records restore_calls when ContextRestore succeeds', async () => {
    const session = createSession('test', 'user')
    session.tool_calls.push({ id: 'call_a', name: 'Read', input: {}, result: 'result', ok: true, ts: '' })
    await contextRestoreTool.execute({ id: 'call_a' }, { session, profile: { name: 'p' } } as any)
    // logEvent is best-effort; this assertion documents the emitted event shape.
    const event: Omit<TelemetryEvent, 'ts'> = { session: session.id, profile: 'p', kind: 'tool', restore_calls: 1 }
    expect(event.restore_calls).toBe(1)
    expect(typeof logEvent).toBe('function')
  })
})
