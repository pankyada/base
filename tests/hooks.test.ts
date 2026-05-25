import { describe, it, expect, vi } from 'vitest'
import { runHooks } from '../src/hooks/runner.js'

function makeProfile(hookCmds: string[], timeout_ms = 5000): any {
  return {
    name: 'test',
    hooks: {
      pre_tool: hookCmds,
      post_tool: [],
      on_stop: [],
      timeout_ms,
    },
  }
}

describe('runHooks', () => {
  it('runs a hook command successfully without error logging', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('pre_tool', makeProfile(['echo hello']), {})
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('logs error when hook exits with non-zero status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('pre_tool', makeProfile(['false']), {})
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[hook:pre_tool] failed'))
    spy.mockRestore()
  })

  it('logs timeout warning when hook exceeds timeout_ms', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('pre_tool', makeProfile(['sleep 5'], 100), {})
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    spy.mockRestore()
  }, 5000)

  it('passes env vars to hook command', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('post_tool', makeProfile(['echo $MY_VAR']), { MY_VAR: 'hello' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('is a no-op when hook list is empty', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('on_stop', makeProfile([]), {})
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
