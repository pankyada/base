import { useReducer, useCallback, useRef } from 'react'
import type { ServerMessage } from '../../types.js'

export interface MemoryKey {
  key: string
  isNew: boolean
  preview?: string
}

type Action =
  | { event: 'write'; key: string; preview?: string }
  | { event: 'age'; key: string }

export function memoryReducer(state: MemoryKey[], action: Action): MemoryKey[] {
  switch (action.event) {
    case 'write': {
      const exists = state.find(k => k.key === action.key)
      if (exists) {
        return state.map(k =>
          k.key === action.key ? { ...k, isNew: true, preview: action.preview ?? k.preview } : k
        )
      }
      return [...state, { key: action.key, isNew: true, preview: action.preview }]
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
  const pendingPreviewRef = useRef('')

  const handleMessage = useCallback((msg: ServerMessage) => {
    // Capture content preview from tool_start before the write completes
    if (msg.type === 'tool_start' && msg.name === 'MemoryWrite') {
      const content = String((msg.input as Record<string, unknown>).content ?? '')
      const firstLine = content.split('\n')[0]
      pendingPreviewRef.current = firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine
      return
    }
    if (msg.type === 'tool_end' && msg.name === 'MemoryWrite') {
      // Result format: "Memory written: session/key-name"
      const match = msg.result.match(/Memory written:\s*\w+\/(.+)/)
      if (match) {
        const key = match[1].trim()
        const preview = pendingPreviewRef.current
        pendingPreviewRef.current = ''
        dispatch({ event: 'write', key, preview })
        setTimeout(() => dispatch({ event: 'age', key }), 3000)
      }
    }
  }, [])

  return { memoryKeys, handleMessage }
}
