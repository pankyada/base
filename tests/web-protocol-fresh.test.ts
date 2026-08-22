import { execFileSync } from 'child_process'
import { describe, expect, it } from 'vitest'

describe('web protocol generation', () => {
  it('reports the generated protocol as fresh', () => {
    expect(() => execFileSync('node', ['scripts/gen-web-protocol.mjs', '--check'], { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow()
  })
})
