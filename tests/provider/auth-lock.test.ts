import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withCodexAuthLock } from '../../src/provider/auth/lock.js'

describe('Codex auth lock', () => {
  it('serializes same-process mutations', async () => { const home = mkdtempSync(join(tmpdir(), 'harness-codex-lock-')); const order: string[] = []; const first = withCodexAuthLock(async () => { order.push('first-start'); await new Promise(resolve => setTimeout(resolve, 20)); order.push('first-end') }, { home }); const second = withCodexAuthLock(async () => { order.push('second') }, { home }); await Promise.all([first, second]); expect(order).toEqual(['first-start', 'first-end', 'second']) })
})
