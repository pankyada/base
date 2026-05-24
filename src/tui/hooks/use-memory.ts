import { useReducer, useCallback } from 'react'
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

export interface UseMemoryResult {
  memoryKeys: MemoryKey[]
  handleMessage: (msg: ServerMessage) => void
}

export function useMemory(): UseMemoryResult {
  const [memoryKeys, dispatch] = useReducer(memoryReducer, [])

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'tool_end' && msg.name === 'MemoryWrite') {
      const match = msg.result.match(/Wrote memory key:\s*(.+)/)
      if (match) {
        const key = match[1].trim()
        dispatch({ event: 'write', key })
        setTimeout(() => dispatch({ event: 'age', key }), 3000)
      }
    }
  }, [])

  return { memoryKeys, handleMessage }
}
