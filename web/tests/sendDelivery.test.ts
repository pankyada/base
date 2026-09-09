import { describe, expect, it } from 'vitest'
import { sendFrame } from '../hooks/useHarnessWS'
import { reducer, initialState } from '../lib/reducer'

const OPEN = 1
const CLOSED = 3

describe('send delivery truth', () => {
  it('reports the frame sent when the socket is open', () => {
    const written: string[] = []
    const socket = { readyState: OPEN, send: (data: string) => { written.push(data) } }
    expect(sendFrame(socket, { type: 'message', content: 'hi' })).toEqual({ ok: true })
    expect(written).toHaveLength(1)
  })

  it('reports not-connected without writing when there is no socket', () => {
    expect(sendFrame(null, { type: 'message', content: 'hi' })).toEqual({ ok: false, reason: 'not-connected' })
  })

  it('reports not-connected when the socket is not open', () => {
    const written: string[] = []
    const socket = { readyState: CLOSED, send: (data: string) => { written.push(data) } }
    expect(sendFrame(socket, { type: 'message', content: 'hi' })).toEqual({ ok: false, reason: 'not-connected' })
    expect(written).toHaveLength(0)
  })

  it('reports write-failed with the reason when the socket throws', () => {
    const socket = { readyState: OPEN, send: () => { throw new Error('socket gone') } }
    expect(sendFrame(socket, { type: 'message', content: 'hi' })).toEqual({ ok: false, reason: 'write-failed', detail: 'socket gone' })
  })
})

describe('failed send does not enter a working state', () => {
  it('retains the composed input and stays idle when a send fails', () => {
    const typed = reducer(initialState, { type: 'INPUT', payload: 'unsent text' })
    const failed = reducer(typed, { type: 'SEND_FAILED', reason: 'not-connected' })
    expect(failed.input).toBe('unsent text')
    expect(failed.busy).toBe(false)
    expect(failed.messages).toHaveLength(0)
    expect(failed.sendError).toBe('not-connected')
  })

  it('clears the failure once the operator edits the input again', () => {
    const failed = reducer({ ...initialState, input: 'x', sendError: 'not-connected' }, { type: 'INPUT', payload: 'xy' })
    expect(failed.sendError).toBeUndefined()
  })

  it('clears the failure and enters a working state only on a successful send', () => {
    const failed = reducer({ ...initialState, input: 'hi', sendError: 'write-failed' }, { type: 'USER_MSG', payload: 'hi' })
    expect(failed.sendError).toBeUndefined()
    expect(failed.busy).toBe(true)
    expect(failed.input).toBe('')
    expect(failed.messages).toHaveLength(1)
  })
})
