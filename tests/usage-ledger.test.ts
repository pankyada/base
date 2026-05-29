import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { recordUsage, readUsage } from '../src/usage/ledger.js'

describe('recordUsage', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'harness-usage-'))
  })

  it('creates a new file with correct totals', () => {
    recordUsage('alice', { input: 100, output: 50, cost_usd: 0.01 }, tmpDir)
    const data = readUsage('alice', tmpDir)
    expect(data).not.toBeNull()
    expect(data!.user).toBe('alice')
    expect(data!.total.input).toBe(100)
    expect(data!.total.output).toBe(50)
    expect(data!.total.cost_usd).toBeCloseTo(0.01)
  })

  it('accumulates across multiple calls', () => {
    recordUsage('alice', { input: 100, output: 50, cost_usd: 0.01 }, tmpDir)
    recordUsage('alice', { input: 200, output: 80, cost_usd: 0.02 }, tmpDir)
    const data = readUsage('alice', tmpDir)!
    expect(data.total.input).toBe(300)
    expect(data.total.output).toBe(130)
    expect(data.total.cost_usd).toBeCloseTo(0.03)
  })

  it('records current month in by_month', () => {
    recordUsage('alice', { input: 50, output: 20, cost_usd: 0.005 }, tmpDir)
    const data = readUsage('alice', tmpDir)!
    const month = new Date().toISOString().slice(0, 7)
    expect(data.by_month[month]).toBeDefined()
    expect(data.by_month[month].input).toBe(50)
  })

  it('accumulates within the same month', () => {
    recordUsage('alice', { input: 10, output: 5, cost_usd: 0.001 }, tmpDir)
    recordUsage('alice', { input: 20, output: 10, cost_usd: 0.002 }, tmpDir)
    const data = readUsage('alice', tmpDir)!
    const month = new Date().toISOString().slice(0, 7)
    expect(data.by_month[month].input).toBe(30)
  })

  it('recovers from a corrupt file and starts fresh', () => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, 'alice.json'), 'NOT JSON', 'utf-8')
    expect(() => recordUsage('alice', { input: 1, output: 1, cost_usd: 0.001 }, tmpDir)).not.toThrow()
    const data = readUsage('alice', tmpDir)!
    expect(data.total.input).toBe(1)
  })

  it('keeps separate ledgers for different users', () => {
    recordUsage('alice', { input: 100, output: 50, cost_usd: 0.01 }, tmpDir)
    recordUsage('bob', { input: 200, output: 100, cost_usd: 0.02 }, tmpDir)
    expect(readUsage('alice', tmpDir)!.total.input).toBe(100)
    expect(readUsage('bob', tmpDir)!.total.input).toBe(200)
  })
})
