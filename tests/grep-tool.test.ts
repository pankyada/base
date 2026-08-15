import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { grepTool } from '../src/tools/builtin/grep.js'

describe('Grep tool', () => {
  it('returns no matches without treating grep exit 1 as a tool failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-tool-'))
    const file = join(dir, 'sample.txt')
    writeFileSync(file, 'present\n')

    await expect(grepTool.execute({ pattern: 'missing', path: file }, {} as any)).resolves.toBe('(no matches)')
  })

  it('treats a dash-prefixed pattern as an operand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-tool-'))
    const file = join(dir, 'sample.txt')
    writeFileSync(file, '-needle\n')

    await expect(grepTool.execute({ pattern: '-needle', path: file, flags: '-n' }, {} as any)).resolves.toContain('-needle')
  })

  it('preserves flag values supplied as structured arguments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-tool-'))
    writeFileSync(join(dir, 'match.ts'), 'needle\n')
    writeFileSync(join(dir, 'skip.js'), 'needle\n')

    const result = await grepTool.execute({ pattern: 'needle', path: dir, flags: ['-r', '--include', '*.ts'] }, {} as any)
    expect(result).toContain('match.ts')
    expect(result).not.toContain('skip.js')
  })

  it('stops immediately when the enclosing turn was cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(grepTool.execute({ pattern: 'anything', path: tmpdir() }, { signal: controller.signal } as any))
      .rejects.toThrow('Grep cancelled')
  })

  it('does not block cancellation while grep waits on a named pipe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-tool-'))
    const fifo = join(dir, 'blocked.fifo')
    execFileSync('mkfifo', [fifo])
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20)

    try {
      await expect(grepTool.execute({ pattern: 'anything', path: fifo }, { signal: controller.signal } as any))
        .rejects.toThrow('Grep cancelled')
    } finally {
      clearTimeout(timer)
    }
  })
})
