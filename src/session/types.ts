export interface SessionToolCall {
  name: string
  input: Record<string, unknown>
  result: string
  ok: boolean
  ts: string
}

export interface Session {
  id: string
  profile: string
  created_at: string
  messages: unknown[]
  tool_calls: SessionToolCall[]
  usage: { input: number; output: number; cost_usd: number }
  session_memory: Record<string, string>
}
