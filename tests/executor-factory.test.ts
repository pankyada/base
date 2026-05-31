import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawn } from 'child_process'
import { executeWithFallback } from '../src/executor/factory.js'

vi.mock('child_process', () => ({ spawn: vi.fn() }))

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>

const fakeResult = { id: '1', stdout: 'ok', stderr: '', exit_code: 0, files: {}, duration_ms: 10 }

function makeCtx(wasmSupported = false): any {
  return {
    wasmSupported,
    events: { onCodeExecute: vi.fn().mockResolvedValue(fakeResult) },
  }
}

function makeProfile(executorDefault: 'wasm' | 'docker' = 'docker'): any {
  return {
    executor: { default: executorDefault, fallback: 'docker', docker_image: 'python:3.12-slim', timeout_ms: 5000 },
  }
}

function mockDockerSpawn(stdout: string) {
  const EventEmitter = require('events')
  const proc: any = new EventEmitter()
  proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = vi.fn()
  setTimeout(() => { proc.stdout.emit('data', Buffer.from(stdout)); proc.emit('close', 0) }, 10)
  mockSpawn.mockReturnValue(proc)
  return proc
}

describe('executeWithFallback', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('uses WasmExecutor when client supports WASM and profile default is wasm', async () => {
    const ctx = makeCtx(true)
    const result = await executeWithFallback(makeProfile('wasm'), ctx, { id: '1', code: 'pass', language: 'python' })
    expect(ctx.events.onCodeExecute).toHaveBeenCalledWith('1', 'pass', 'python', undefined)
    expect(result).toEqual(fakeResult)
  })

  it('uses DockerExecutor when client does not support WASM', async () => {
    mockDockerSpawn('docker-out')
    const ctx = makeCtx(false)
    const result = await executeWithFallback(makeProfile('wasm'), ctx, { id: '2', code: 'pass', language: 'python' })
    expect(ctx.events.onCodeExecute).not.toHaveBeenCalled()
    expect(result.stdout).toBe('docker-out')
  })

  it('falls back to Docker when WASM throws UnsupportedLanguageError', async () => {
    mockDockerSpawn('node-out')
    const ctx = makeCtx(true)
    const result = await executeWithFallback(makeProfile('wasm'), ctx, { id: '3', code: 'console.log(1)', language: 'javascript' })
    expect(result.stdout).toBe('node-out')
  })

  it('uses DockerExecutor directly when profile default is docker', async () => {
    const proc = mockDockerSpawn('')
    const ctx = makeCtx(true)
    await executeWithFallback(makeProfile('docker'), ctx, { id: '4', code: 'pass', language: 'python' })
    expect(ctx.events.onCodeExecute).not.toHaveBeenCalled()
    expect(proc.kill).not.toHaveBeenCalled()
  })
})
