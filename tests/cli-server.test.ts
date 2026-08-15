import { describe, expect, it } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runServerCommand, ServerCommandOutput } from '../src/cli/server.js'
import { registerServer, serverRecordFor } from '../src/server/process-registry.js'

function output(): { sink: ServerCommandOutput; lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { sink: { log: line => lines.push(line), error: line => errors.push(line) }, lines, errors }
}

describe('harness server commands', () => {
  it('lists registered running and stale servers', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'harness-server-cli-'))
    try {
      registerServer({ ...serverRecordFor(7337, 'coding', ['coding'], process.cwd()), pid: process.pid }, directory)
      registerServer({ ...serverRecordFor(7338, 'old', ['old'], process.cwd()), pid: 99999999 }, directory)
      const capture = output()

      expect(await runServerCommand(['list'], capture.sink, directory)).toBe(0)
      expect(capture.lines[0]).toContain('PID\tPORT\tPROFILE\tSTATUS')
      expect(capture.lines.join('\n')).toContain('7337')
      expect(capture.lines.join('\n')).toContain('stale')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('stops a selected server and removes stale records', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'harness-server-cli-'))
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'])
    try {
      await new Promise(resolve => child.once('spawn', resolve))
      registerServer({ ...serverRecordFor(7337, 'coding', ['coding'], process.cwd()), pid: child.pid! }, directory)
      const capture = output()
      const exited = new Promise(resolve => child.once('exit', resolve))

      expect(await runServerCommand(['stop', '7337'], capture.sink, directory)).toBe(0)
      expect(capture.lines[0]).toContain('Stop signal sent')
      await exited

      registerServer({ ...serverRecordFor(7338, 'old', ['old'], process.cwd()), pid: 99999999 }, directory)
      const staleCapture = output()
      expect(await runServerCommand(['stop', '7338'], staleCapture.sink, directory)).toBe(0)
      expect(staleCapture.lines[0]).toContain('Removed stale')
    } finally {
      if (!child.killed) child.kill('SIGKILL')
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
