import { expect, it } from 'vitest'
import { runMockProbe } from '../../scripts/probe-codex.js'

it('exercises isolated text, tool call, and stateless continuation without live credentials', async () => {
  const result = await runMockProbe()
  expect(result).toMatchObject({ mode: 'mock', text: true, tool_roundtrip: true, requests: 3, billing_verified: false })
  expect(JSON.stringify(result)).not.toMatch(/synthetic-access|synthetic-refresh|synthetic-opaque/)
})
