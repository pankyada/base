import { useReducer, useEffect } from 'react'
import type { ServerMessage } from '../../types.js'

export interface ToolEntry {
  name: string
  status: 'running' | 'ok' | 'err'
  duration_ms?: number
  ts: number
}

type Action =
  | { event: 'start'; name: string; input: Record<string, unknown> }
  | { event: 'end'; name: string; ok: boolean; duration_ms: number }

const MAX_ENTRIES = 20

export function toolsReducer(state: ToolEntry[], action: Action): ToolEntry[] {
  switch (action.event) {
    case 'start': {
      const entry: ToolEntry = { name: action.name, status: 'running', ts: Date.now() }
      const next = [...state, entry]
      return next.slice(-MAX_ENTRIES)
    }
    case 'end': {
      // Update most recent running entry for this tool name
      const idx = [...state].reverse().findIndex(e => e.name === action.name && e.status === 'running')
      if (idx === -1) return state
      const realIdx = state.length - 1 - idx
      const updated = [...state]
      updated[realIdx] = {
        ...updated[realIdx],
        status: action.ok ? 'ok' : 'err',
        duration_ms: action.duration_ms,
      }
      return updated
    }
    default:
      return state
  }
}

export function useTools(lastMessage: ServerMessage | null): ToolEntry[] {
  const [tools, dispatch] = useReducer(toolsReducer, [])

  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'tool_start') {
      dispatch({ event: 'start', name: lastMessage.name, input: lastMessage.input })
    } else if (lastMessage.type === 'tool_end') {
      const ok = !lastMessage.result.startsWith('Error:')
      dispatch({ event: 'end', name: lastMessage.name, ok, duration_ms: 0 })
    }
  }, [lastMessage])

  return tools
}
