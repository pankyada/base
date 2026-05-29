import { useReducer, useCallback } from 'react'
import type { ServerMessage } from '../../types.js'

export interface ToolEntry {
  name: string
  status: 'running' | 'ok' | 'err'
  duration_ms?: number
  ts: number
}

type Action =
  | { event: 'start'; name: string }
  | { event: 'end'; name: string; ok: boolean }

const MAX_ENTRIES = 20

export function toolsReducer(state: ToolEntry[], action: Action): ToolEntry[] {
  switch (action.event) {
    case 'start': {
      const entry: ToolEntry = { name: action.name, status: 'running', ts: Date.now() }
      return [...state, entry].slice(-MAX_ENTRIES)
    }
    case 'end': {
      const idx = [...state].reverse().findIndex(e => e.name === action.name && e.status === 'running')
      if (idx === -1) return state
      const realIdx = state.length - 1 - idx
      const entry = state[realIdx]
      const duration_ms = Date.now() - entry.ts
      const updated = [...state]
      updated[realIdx] = { ...entry, status: action.ok ? 'ok' : 'err', duration_ms }
      return updated
    }
    default:
      return state
  }
}

export interface UseToolsResult {
  tools: ToolEntry[]
  handleMessage: (msg: ServerMessage) => void
}

export function useTools(): UseToolsResult {
  const [tools, dispatch] = useReducer(toolsReducer, [])

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'tool_start') {
      dispatch({ event: 'start', name: msg.name })
    } else if (msg.type === 'tool_end') {
      const ok = !msg.result.startsWith('Error:')
      dispatch({ event: 'end', name: msg.name, ok })
    }
  }, [])

  return { tools, handleMessage }
}
