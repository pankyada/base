import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { grepArgs, grepTool } from '../src/tools/builtin/grep.js'

describe('Grep tool', () => {
  it('skips dependency, VCS and build directories and binary files on recursive searches by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-tool-'))
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true })
    mkdirSync(join(dir, '.next'), { recursive: true })
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'needle\n')
    writeFileSync(join(dir, '.next', 'chunk.js'), 'needle\n')
    writeFileSync(join(dir, 'src', 'app.ts'), 'needle\n')
    writeFileSync(join(dir, 'src', 'blob.bin'), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from('needle\n')]))

    const result = await grepTool.execute({ pattern: 'needle', path: dir }, {} as any)
    expect(result).toContain('src/app.ts')
    expect(result).not.toContain('node_modules')
    expect(result).not.toContain('.next')
    expect(result).not.toContain('blob.bin')
  })

  it('lets explicit include/exclude and binary flags override the defaults', () => {
    expect(grepArgs('x', '.', ['-r', '--include', '*.ts'])).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--exclude-dir=/)]))
    expect(grepArgs('x', '.', ['-r', '--exclude-dir=only'])).toEqual(['-I', '-r', '--exclude-dir=only', '--', 'x', '.'])
    expect(grepArgs('x', '.', '-rna')).not.toContain('-I')
    expect(grepArgs('x', 'file.txt', '-n')).toEqual(['-I', '-n', '--', 'x', 'file.txt'])
  })

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
