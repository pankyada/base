import { describe, it, expect, vi } from 'vitest'
import { executeCodeTool } from '../src/tools/builtin/execute-code.js'

const fakeResult = { id: 'r1', stdout: 'hello\n', stderr: '', exit_code: 0, files: { 'out.csv': 'aGVsbG8=' }, duration_ms: 250 }

function makeCtx(hasExecutor = true, wasmSupported = false): any {
  return {
    wasmSupported,
    profile: hasExecutor
      ? { executor: { default: 'docker', fallback: 'docker', docker_image: 'python:3.12-slim', timeout_ms: 5000 } }
      : {},
    session: {},
    events: { onCodeExecute: vi.fn().mockResolvedValue(fakeResult) },
  }
}

describe('ExecuteCode tool', () => {
  it('returns graceful message when executor not configured', async () => {
    const result = await executeCodeTool.execute({ code: 'pass', language: 'python' }, makeCtx(false))
    expect(result).toBe('Code execution not enabled in this profile — add an executor: block to enable it')
  })

  it('returns formatted output on success', async () => {
    vi.spyOn(await import('../src/executor/factory.js'), 'executeWithFallback').mockResolvedValue(fakeResult)
    const result = await executeCodeTool.execute({ code: 'print("hello")', language: 'python' }, makeCtx(true))
    expect(result).toContain('exit_code: 0')
    expect(result).toContain('hello\n')
    expect(result).toContain('out.csv')
    expect(result).toContain('250ms')
  })

  it('includes stderr in output when present', async () => {
    vi.spyOn(await import('../src/executor/factory.js'), 'executeWithFallback')
      .mockResolvedValue({ ...fakeResult, stderr: 'warning: deprecated\n', exit_code: 0 })
    const result = await executeCodeTool.execute({ code: 'pass', language: 'python' }, makeCtx(true))
    expect(result).toContain('warning: deprecated')
  })

  it('catches errors and returns Error: message', async () => {
    vi.spyOn(await import('../src/executor/factory.js'), 'executeWithFallback')
      .mockRejectedValue(new Error('Docker not found'))
    const result = await executeCodeTool.execute({ code: 'pass', language: 'python' }, makeCtx(true))
    expect(result).toBe('Error: Docker not found')
  })
})
