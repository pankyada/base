import { describe, it, expect, vi } from 'vitest'
import { WasmExecutor } from '../src/executor/wasm.js'
import { UnsupportedLanguageError } from '../src/executor/interface.js'

function makeCtx(onCodeExecute?: (...args: any[]) => any): any {
  return { events: { onCodeExecute } }
}

describe('WasmExecutor', () => {
  it('calls onCodeExecute and returns the result', async () => {
    const fakeResult = { id: 'abc', stdout: 'hello\n', stderr: '', exit_code: 0, files: {}, duration_ms: 100 }
    const onCodeExecute = vi.fn().mockResolvedValue(fakeResult)
    const executor = new WasmExecutor(makeCtx(onCodeExecute))
    const result = await executor.execute({ id: 'abc', code: 'print("hello")', language: 'python' })
    expect(onCodeExecute).toHaveBeenCalledWith('abc', 'print("hello")', 'python', undefined)
    expect(result).toEqual(fakeResult)
  })

  it('passes data to onCodeExecute', async () => {
    const fakeResult = { id: 'x', stdout: '', stderr: '', exit_code: 0, files: {}, duration_ms: 10 }
    const onCodeExecute = vi.fn().mockResolvedValue(fakeResult)
    const executor = new WasmExecutor(makeCtx(onCodeExecute))
    const data = { x: 1, y: [2, 3] }
    await executor.execute({ id: 'x', code: 'pass', language: 'python', data })
    expect(onCodeExecute).toHaveBeenCalledWith('x', 'pass', 'python', data)
  })

  it('throws UnsupportedLanguageError for non-python languages', async () => {
    const executor = new WasmExecutor(makeCtx())
    await expect(executor.execute({ id: 'y', code: 'console.log(1)', language: 'javascript' }))
      .rejects.toBeInstanceOf(UnsupportedLanguageError)
  })

  it('throws if onCodeExecute is not wired', async () => {
    const executor = new WasmExecutor(makeCtx(undefined))
    await expect(executor.execute({ id: 'z', code: 'pass', language: 'python' }))
      .rejects.toThrow('onCodeExecute is not wired')
  })
})
