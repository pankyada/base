import { useReducer, useCallback } from 'react'
import type { ServerMessage } from '../../types.js'

export interface UserMessage {
  role: 'user'
  content: string
  id: string
}

export interface AssistantMessage {
  role: 'assistant'
  content: string
  streaming: boolean
  id: string
}

export interface ToolCallMessage {
  role: 'tool-call'
  name: string
  input: Record<string, unknown>
  result?: string
  status: 'running' | 'ok' | 'err'
  duration_ms?: number
  startTs: number
  id: string
}

export interface ToolPromptMessage {
  role: 'tool-prompt'
  name: string
  input: Record<string, unknown>
  id: string
  pending: boolean
}

export type ChatMessage = UserMessage | AssistantMessage | ToolCallMessage | ToolPromptMessage

type Action =
  | { event: 'user'; content: string }
  | { event: 'token'; content: string }
  | { event: 'seal' }
  | { event: 'tool_start'; name: string; input: Record<string, unknown>; id: string }
  | { event: 'tool_end'; name: string; result: string; id: string }
  | { event: 'tool_prompt'; id: string; name: string; input: Record<string, unknown> }
  | { event: 'tool_prompt_resolve'; id: string }
  | { event: 'clear' }

let counter = 0
const uid = () => String(++counter)

export function messagesReducer(state: ChatMessage[], action: Action): ChatMessage[] {
  switch (action.event) {
    case 'user':
      return [...state, { role: 'user', content: action.content, id: uid() }]

    case 'token': {
      const last = state[state.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        return [
          ...state.slice(0, -1),
          { ...last, content: last.content + action.content },
        ]
      }
      return [...state, { role: 'assistant', content: action.content, streaming: true, id: uid() }]
    }

    case 'seal': {
      const last = state[state.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        return [...state.slice(0, -1), { ...last, streaming: false }]
      }
      return state
    }

    case 'tool_start':
      return [...state, {
        role: 'tool-call', name: action.name, input: action.input,
        status: 'running', startTs: Date.now(), id: action.id,
      }]

    case 'tool_end': {
      return state.map(m => {
        if (m.role !== 'tool-call' || m.name !== action.name || m.status !== 'running') return m
        const duration_ms = Date.now() - m.startTs
        const ok = !action.result.startsWith('Error:')
        return { ...m, result: action.result, status: ok ? 'ok' : 'err', duration_ms }
      })
    }

    case 'tool_prompt':
      return [...state, {
        role: 'tool-prompt', name: action.name, input: action.input,
        id: action.id, pending: true,
      }]

    case 'tool_prompt_resolve':
      return state.map(m =>
        m.role === 'tool-prompt' && m.id === action.id ? { ...m, pending: false } : m
      )

    case 'clear':
      return []

    default:
      return state
  }
}

export interface UseMessagesResult {
  messages: ChatMessage[]
  dispatch: (action: Action) => void
  /** Call this directly from the WS onMessage handler — no state hop. */
  handleMessage: (msg: ServerMessage) => void
}

export function useMessages(): UseMessagesResult {
  const [messages, dispatch] = useReducer(messagesReducer, [])

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'token':
        dispatch({ event: 'token', content: msg.content })
        break
      case 'tool_start':
        dispatch({ event: 'tool_start', name: msg.name, input: msg.input, id: msg.name + Date.now() })
        break
      case 'tool_end':
        dispatch({ event: 'tool_end', name: msg.name, result: msg.result, id: msg.name })
        break
      case 'tool_prompt':
        dispatch({ event: 'tool_prompt', id: msg.id, name: msg.name, input: msg.input })
        break
      case 'session_end':
        dispatch({ event: 'seal' })
        break
    }
  }, [])

  return { messages, dispatch, handleMessage }
}
