export type AclValue = 'allow' | 'prompt' | 'deny'

export interface TelemetryEvent {
  ts: string
  session: string
  profile: string
  kind: 'tool' | 'skill' | 'mcp' | 'llm'
  name?: string
  server?: string
  model?: string
  duration_ms?: number
  ok?: boolean
  tokens_in?: number
  tokens_out?: number
  cost_usd?: number
  trigger?: string
}

// WebSocket protocol
export type ClientMessage =
  | { type: 'message'; content: string }
  | { type: 'cancel' }
  | { type: 'resume'; sessionId: string }
  | { type: 'tool_approve'; id: string }
  | { type: 'tool_deny'; id: string }

export type ServerMessage =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'tool_prompt'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'session_end'; sessionId: string }
  | { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number }
  | { type: 'error'; message: string }
