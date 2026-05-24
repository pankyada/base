import { useReducer, useEffect } from 'react'
import type { ServerMessage } from '../../types.js'

export interface MemoryKey {
  key: string
  isNew: boolean
}

type Action =
  | { event: 'write'; key: string }
  | { event: 'age'; key: string }

export function memoryReducer(state: MemoryKey[], action: Action): MemoryKey[] {
  switch (action.event) {
    case 'write': {
      const exists = state.find(k => k.key === action.key)
      if (exists) {
        return state.map(k => k.key === action.key ? { ...k, isNew: true } : k)
      }
      return [...state, { key: action.key, isNew: true }]
    }
    case 'age':
      return state.map(k => k.key === action.key ? { ...k, isNew: false } : k)
    default:
      return state
  }
}

export function useMemory(lastMessage: ServerMessage | null): MemoryKey[] {
  const [keys, dispatch] = useReducer(memoryReducer, [])

  useEffect(() => {
    if (!lastMessage) return
    // MemoryWrite tool_end carries the key as part of the result
    if (
      lastMessage.type === 'tool_end' &&
      lastMessage.name === 'MemoryWrite'
    ) {
      // Result format: "Wrote memory key: <key>"
      const match = lastMessage.result.match(/Wrote memory key:\s*(.+)/)
      if (match) {
        const key = match[1].trim()
        dispatch({ event: 'write', key })
        setTimeout(() => dispatch({ event: 'age', key }), 3000)
      }
    }
  }, [lastMessage])

  return keys
}
