import { describe, it, expect } from 'vitest'
import { messagesReducer, ChatMessage } from '../../src/tui/hooks/use-messages.js'
import type { ServerMessage } from '../../src/types.js'

describe('messagesReducer', () => {
  it('appends user message', () => {
    const state: ChatMessage[] = []
    const next = messagesReducer(state, { event: 'user', content: 'hello' })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ role: 'user', content: 'hello' })
  })

  it('creates streaming assistant message on first token', () => {
    const state: ChatMessage[] = []
    const next = messagesReducer(state, { event: 'token', content: 'Hi' })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ role: 'assistant', content: 'Hi', streaming: true })
  })

  it('appends subsequent tokens to streaming message', () => {
    let state = messagesReducer([], { event: 'token', content: 'Hi' })
    state = messagesReducer(state, { event: 'token', content: ' there' })
    expect(state).toHaveLength(1)
    expect((state[0] as { content: string }).content).toBe('Hi there')
  })

  it('seals streaming message on session_end', () => {
    let state = messagesReducer([], { event: 'token', content: 'Done' })
    state = messagesReducer(state, { event: 'seal' })
    expect((state[0] as { streaming: boolean }).streaming).toBe(false)
  })

  it('appends tool_prompt message', () => {
    const state: ChatMessage[] = []
    const next = messagesReducer(state, {
      event: 'tool_prompt', id: 'abc', name: 'Bash', input: { command: 'ls' }
    })
    expect(next[0]).toMatchObject({ role: 'tool-prompt', name: 'Bash', id: 'abc' })
  })

  it('clears all messages on clear', () => {
    let state = messagesReducer([], { event: 'user', content: 'hi' })
    state = messagesReducer(state, { event: 'clear' })
    expect(state).toHaveLength(0)
  })
})
