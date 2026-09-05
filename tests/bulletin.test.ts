import { describe, expect, it } from 'vitest'
import { Bulletin } from '../src/agents/bulletin.js'

const base = { session_id: 's', from_agent_id: 'a', from_agent_name: 'agent', to: 'all' as const, kind: 'post' as const, subject: 'status', body: 'ready', tainted: false }

describe('bulletin', () => {
  it('orders posts monotonically and caps one agent turn', () => {
    const board = new Bulletin()
    expect(board.post(base, 'a:1').seq).toBe(1)
    expect(board.post({ ...base, subject: 'two' }, 'a:1').seq).toBe(2)
    board.post({ ...base, subject: 'three' }, 'a:1'); board.post({ ...base, subject: 'four' }, 'a:1'); board.post({ ...base, subject: 'five' }, 'a:1')
    expect(() => board.post({ ...base, subject: 'six' }, 'a:1')).toThrow('5 posts already made')
    expect(board.read('b').map(post => post.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('rejects oversized cards and limits addressed reads', () => {
    const board = new Bulletin()
    expect(() => board.post({ ...base, subject: 'x'.repeat(121) }, 'a:1')).toThrow('maximum is 120')
    expect(() => board.post({ ...base, body: 'x'.repeat(2049) }, 'a:1')).toThrow('maximum is 2048')
    board.post({ ...base, to: ['b'], subject: 'private' }, 'a:2')
    expect(board.read('c')).toEqual([])
    expect(board.read('b')[0].subject).toBe('private')
  })
})
