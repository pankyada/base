import { useReducer, useEffect } from 'react'
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
  | { event: 'tool_end'; name: string; result: string; ok: boolean; duration_ms: number; id: string }
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
        status: 'running', id: action.id,
      }]

    case 'tool_end': {
      return state.map(m =>
        m.role === 'tool-call' && m.name === action.name && m.status === 'running'
          ? { ...m, result: action.result, status: action.ok ? 'ok' : 'err', duration_ms: action.duration_ms }
          : m
      )
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
}

export function useMessages(lastMessage: ServerMessage | null): UseMessagesResult {
  const [messages, dispatch] = useReducer(messagesReducer, [])

  useEffect(() => {
    if (!lastMessage) return
    switch (lastMessage.type) {
      case 'token':
        dispatch({ event: 'token', content: lastMessage.content })
        break
      case 'tool_start':
        dispatch({ event: 'tool_start', name: lastMessage.name, input: lastMessage.input, id: lastMessage.name + Date.now() })
        break
      case 'tool_end':
        dispatch({ event: 'tool_end', name: lastMessage.name, result: lastMessage.result, ok: true, duration_ms: 0, id: lastMessage.name })
        break
      case 'tool_prompt':
        dispatch({ event: 'tool_prompt', id: lastMessage.id, name: lastMessage.name, input: lastMessage.input })
        break
      case 'session_end':
        dispatch({ event: 'seal' })
        break
    }
  }, [lastMessage])

  return { messages, dispatch }
}
