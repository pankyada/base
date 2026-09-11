import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CursorStore } from '../src/triggers/cursors.js'
import { PollTrigger, cursorAt, intervalMs } from '../src/triggers/poll.js'

function cursorStore() {
  let value: any = null
  return {
    read: vi.fn(() => value),
    write: vi.fn((_user, _profile, _name, next) => { value = next }),
  }
}

describe('PollTrigger', () => {
  it('cold-starts without firing, then skips unchanged cursors without model work', async () => {
    const cursors = cursorStore()
    const fire = vi.fn()
    const skip = vi.fn()
    let cursor = 'a'
    let modelTokens = 0
    const trigger = new PollTrigger(
      { name: 'mail', every: '5m', probe: { tool: 'mail__list' }, cursor_path: 'messages[0].id' },
      'user', 'profile', cursors as any, async () => ({ messages: [{ id: cursor }] }), fire, skip,
    )
    const model = () => { modelTokens++ }
    await trigger.tick()
    model()
    await trigger.tick()
    expect(modelTokens).toBe(1)
    expect(fire).not.toHaveBeenCalled()
    expect(skip).toHaveBeenCalledWith('cursor_unchanged', expect.any(Number))

    cursor = 'b'
    await trigger.tick()
    expect(fire).toHaveBeenCalledWith({ trigger: 'poll', name: 'mail', cursor: 'b' }, expect.any(Object))
  })

  it('records probe failure instead of firing', async () => {
    const cursors = cursorStore()
    const fire = vi.fn()
    const skip = vi.fn()
    const trigger = new PollTrigger(
      { name: 'mail', every: '5m', probe: { tool: 'mail__list' }, cursor_path: 'id' },
      'user', 'profile', cursors as any, async () => { throw new Error('offline') }, fire, skip,
    )
    await trigger.tick()
    expect(fire).not.toHaveBeenCalled()
    expect(skip).toHaveBeenCalledWith('probe_error', expect.any(Number))
  })

  it('aborts an in-flight probe on stop without recording or firing late work', async () => {
    const cursors = cursorStore()
    const fire = vi.fn()
    let aborted = false
    let release!: () => void
    const probe = vi.fn((_tool: string, _args: Record<string, unknown>, signal?: AbortSignal) => new Promise<unknown>((resolve, reject) => {
      release = () => resolve({ id: 'late' })
      signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
    }))
    const trigger = new PollTrigger(
      { name: 'mail', every: '5m', probe: { tool: 'mail__list' }, cursor_path: 'id' },
      'user', 'profile', cursors as any, probe, fire, vi.fn(),
    )
    const running = trigger.tick()
    trigger.stop()
    release()
    await running
    await trigger.tick()
    expect(aborted).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(fire).not.toHaveBeenCalled()
  })

  it('cold-starts after a probe error without firing', async () => {
    const cursors = cursorStore()
    const fire = vi.fn()
    const skip = vi.fn()
    let fails = true
    const trigger = new PollTrigger(
      { name: 'mail', every: '5m', probe: { tool: 'mail__list' }, cursor_path: 'id' },
      'user', 'profile', cursors as any, async () => {
        if (fails) throw new Error('offline')
        return { id: 'first' }
      }, fire, skip,
    )
    await trigger.tick()
    fails = false
    await trigger.tick()
    expect(fire).not.toHaveBeenCalled()
  })

  it('parses bounded interval and JSONPath-lite cursor paths', () => {
    expect(intervalMs('2h')).toBe(7_200_000)
    expect(cursorAt({ messages: [{ id: 42 }] }, 'messages[0].id')).toBe('42')
    expect(cursorAt({}, 'messages[0].id')).toBeNull()
  })

  it('treats a corrupt cursor as cold start and never fires on garbage', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cursor-corrupt-'))
    vi.stubEnv('HOME', home)
    const path = join(home, '.harness', 'cursors', 'user')
    const { mkdirSync } = await import('fs')
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'profile__mail.json'), '{not-json')
    const fire = vi.fn()
    const trigger = new PollTrigger(
      { name: 'mail', every: '5m', probe: { tool: 'mail__list' }, cursor_path: 'id' },
      'user', 'profile', new CursorStore(), async () => ({ id: 'new' }), fire, vi.fn(),
    )
    await trigger.tick()
    expect(fire).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
