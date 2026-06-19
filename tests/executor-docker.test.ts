import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted before imports — must be at top level
const spawnMock = vi.fn()
vi.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }))

// Also mock fs to avoid real tmpdir writes
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    mkdtempSync: vi.fn((prefix: string) => prefix + 'TEST'),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() => Buffer.from('')),
    rmSync: vi.fn(),
  }
})

import { DockerExecutor } from '../src/executor/docker.js'

const defaultCfg: any = {
  docker_image: 'python:3.12-slim',
  timeout_ms: 5000,
}

function makeSpawnResult(stdout: string, stderr: string, exitCode: number) {
  const { EventEmitter } = require('events')
  const proc: any = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  setTimeout(() => {
    proc.stdout.emit('data', Buffer.from(stdout))
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
    proc.emit('close', exitCode)
  }, 10)
  return proc
}

describe('DockerExecutor', () => {
  beforeEach(() => { spawnMock.mockReset() })

  it('runs code and captures stdout', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('hello\n', '', 0))
    const executor = new DockerExecutor(defaultCfg)
    const result = await executor.execute({ id: '1', code: 'print("hello")', language: 'python' })
    expect(result.stdout).toBe('hello\n')
    expect(result.stderr).toBe('')
    expect(result.exit_code).toBe(0)
    expect(result.id).toBe('1')
    expect(spawnMock).toHaveBeenCalledWith('docker', expect.arrayContaining(['run', '--rm']), expect.any(Object))
  })

  it('captures stderr', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('', 'SyntaxError\n', 1))
    const executor = new DockerExecutor(defaultCfg)
    const result = await executor.execute({ id: '2', code: 'bad(', language: 'python' })
    expect(result.stderr).toBe('SyntaxError\n')
    expect(result.exit_code).toBe(1)
  })

  it('returns exit_code 124 on timeout', async () => {
    const { EventEmitter } = require('events')
    const proc: any = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn(() => { setTimeout(() => proc.emit('close', 137), 5) })
    spawnMock.mockReturnValue(proc)
    const executor = new DockerExecutor({ ...defaultCfg, timeout_ms: 50 })
    const result = await executor.execute({ id: '3', code: 'import time; time.sleep(99)', language: 'python' })
    expect(result.exit_code).toBe(124)
    expect(proc.kill).toHaveBeenCalled()
  })

  it('includes duration_ms in result', async () => {
    spawnMock.mockReturnValue(makeSpawnResult('ok', '', 0))
    const executor = new DockerExecutor(defaultCfg)
    const result = await executor.execute({ id: '4', code: 'pass', language: 'python' })
    expect(typeof result.duration_ms).toBe('number')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('handles spawn error gracefully (docker not installed)', async () => {
    const { EventEmitter } = require('events')
    const proc: any = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    // Emit spawn error instead of close
    setTimeout(() => {
      proc.emit('error', new Error('spawn docker ENOENT'))
    }, 5)
    spawnMock.mockReturnValue(proc)
    const executor = new DockerExecutor(defaultCfg)
    const result = await executor.execute({ id: '5', code: 'print("test")', language: 'python' })
    // Should return non-zero exit code and error message in stderr
    expect(result.exit_code).not.toBe(0)
    expect(result.stderr).toContain('docker unavailable')
    expect(result.stderr).toContain('spawn docker ENOENT')
  })
})
