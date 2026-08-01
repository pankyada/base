export interface SessionToolCall {
  id?: string
  name: string
  input: Record<string, unknown>
  result: string
  ok: boolean
  ts: string
}

export interface ContextState {
  pins: Array<{ key: string; text: string }>
  digest?: { upto: number; text: string }
  calib: { ratio: number; samples: number }
}

import type { TodoItem } from '../types.js'

export interface Session {
  id: string
  user: string
  profile: string
  project: string
  title?: string
  summary?: string
  created_at: string
  messages: unknown[]
  context?: ContextState
  tool_calls: SessionToolCall[]
  usage: { input: number; output: number; cost_usd: number }
  session_memory: Record<string, string>
  todos: TodoItem[]
}

export function ensureContextState(session: Session): ContextState {
  if (!session.context) {
    session.context = {
      pins: [],
      calib: { ratio: 1, samples: 0 },
    }
  } else {
    session.context.pins ??= []
    session.context.calib ??= { ratio: 1, samples: 0 }
    session.context.calib.ratio ??= 1
    session.context.calib.samples ??= 0
  }
  return session.context
}

export interface SessionSummary {
  id: string
  project: string
  title?: string
  summary?: string
  created_at: string
  usage: { input: number; output: number; cost_usd: number }
}
