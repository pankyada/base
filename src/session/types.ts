export interface SessionToolCall {
  name: string
  input: Record<string, unknown>
  result: string
  ok: boolean
  ts: string
}

import type { TodoItem } from '../types.js'

export interface Session {
  id: string
  user: string
  profile: string
  created_at: string
  messages: unknown[]
  tool_calls: SessionToolCall[]
  usage: { input: number; output: number; cost_usd: number }
  session_memory: Record<string, string>
  todos: TodoItem[]
}
