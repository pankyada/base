import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'
import type { McpEntry } from '../mcp/client.js'
import type { TodoItem, InputRequestKind } from '../types.js'
import type { ExecutionResult } from '../executor/interface.js'
import type OpenAI from 'openai'

export interface AgentLoopEvents {
  onToken(token: string): void
  onToolStart(name: string, input: Record<string, unknown>): void
  onToolEnd(name: string, result: string): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>): Promise<boolean>
  onSessionEnd(sessionId: string): void
  onStats?(tokens_in: number, tokens_out: number, cost_usd: number): void
  onArtifacts?(sessionId: string, artifacts: any[]): void
  onInputRequest?(id: string, prompt: string, kind: InputRequestKind, options?: string[]): Promise<string>
  onTodosUpdate?(todos: TodoItem[]): void
  onCodeExecute?(id: string, code: string, language: string, data?: Record<string, unknown>): Promise<ExecutionResult>
}

export interface Skill {
  name: string
  description: string
  content: string
  filePath: string
}

export interface ToolContext {
  profile: Profile
  session: Session
  workingDir: string
  memory: MemoryProvider
  skills: Skill[]
  mcpEntries: McpEntry[]
  events: AgentLoopEvents
  openai: OpenAI
  signal?: AbortSignal
  delegateDepth: number
  agentTools?: ToolDefinition[]
  maxDepth?: number
  wasmSupported?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolContext): Promise<string>
}
