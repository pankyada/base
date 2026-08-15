import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'
import type { McpEntry } from '../mcp/client.js'
import type { TodoItem, InputRequestKind, RiskLevel, ApprovalMode, SurfaceSpec, SurfaceRenderResult } from '../types.js'
import type { Stage, Intensity, Tier } from '../workflow/types.js'
import type { ExecutionResult } from '../executor/interface.js'
import type OpenAI from 'openai'
import type { ChannelRuntime } from '../channels/runtime.js'
import type { PendingStore } from '../runs/pending.js'
import type { RunBudget } from '../runs/budget.js'

export type ToolEffect = 'read' | 'write' | 'outbound' | 'destructive'
export type ToolProvenance = 'trusted' | 'untrusted'
export interface UndoDescriptor { kind: string; payload: Record<string, unknown>; expires_at?: string }
export type ToolReturn = string | { content: string; provenance?: ToolProvenance; source?: string; effect?: ToolEffect; undo?: UndoDescriptor }

export type { SurfaceSpec, SurfaceRenderResult } from '../types.js'

export interface AgentLoopEvents {
  onToken(token: string): void
  onToolStart(toolCallId: string, name: string, input: Record<string, unknown>): void
  onToolEnd(toolCallId: string, name: string, result: string, ok: boolean): void
  onToolParked?(toolCallId: string, name: string, input: Record<string, unknown>): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>, risk?: RiskLevel, reason?: string): Promise<boolean>
  onSessionEnd(sessionId: string): void
  onStats?(tokens_in: number, tokens_out: number, cost_usd: number, context_tokens?: number): void
  onNotice?(level: 'info' | 'warn' | 'error', message: string, detail?: string): void
  onSafetyNotice?(model: string): void
  onArtifacts?(sessionId: string, artifacts: any[]): void
  onInputRequest?(id: string, prompt: string, kind: InputRequestKind, options?: string[]): Promise<string>
  onTodosUpdate?(todos: TodoItem[]): void
  onCodeExecute?(id: string, code: string, language: string, data?: Record<string, unknown>): Promise<ExecutionResult>
  onRenderUI?(surface: SurfaceSpec): Promise<SurfaceRenderResult>
  onStage?(stage: Stage, intensity: Intensity, tier: Tier, model: string, state: 'start' | 'done' | 'escalated' | 'skipped', cost_usd?: number): void
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
  approvalMode?: ApprovalMode
  channels?: ChannelRuntime
  pendingInputs?: PendingStore
  runId?: string
  currentToolCallId?: string
  budget?: RunBudget
  unattended?: boolean
  taintSources?: string[]
  stage?: import('../workflow/types.js').StageTag
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolReturn>
}
