import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'
import type { McpEntry } from '../mcp/client.js'
import type { AgentFrame, TodoItem, InputRequestKind, RiskLevel, ApprovalMode, SurfaceSpec, SurfaceRenderResult, EffortCapability } from '../types.js'
import type { Stage, Intensity, Tier } from '../workflow/types.js'
import type { ExecutionResult } from '../executor/interface.js'
import type OpenAI from 'openai'
import type { ProviderClient } from '../provider/types.js'
import type { UsageMetadata } from '../provider/types.js'
import type { SharedAttemptBudget } from '../provider/usage.js'
import type { ChannelRuntime } from '../channels/runtime.js'
import type { PendingStore } from '../runs/pending.js'
import type { RunBudget } from '../runs/budget.js'
import type { Bulletin, BulletinPost } from '../agents/bulletin.js'

export type ToolEffect = 'read' | 'write' | 'outbound' | 'destructive'
export type ToolProvenance = 'trusted' | 'untrusted'
export interface UndoDescriptor { kind: string; payload: Record<string, unknown>; expires_at?: string }
export type ToolReturn = string | { content: string; provenance?: ToolProvenance; source?: string; effect?: ToolEffect; undo?: UndoDescriptor }

export type { SurfaceSpec, SurfaceRenderResult } from '../types.js'

export interface AgentLoopEvents {
  onToken(token: string, agentId?: string): void
  onToolStart(toolCallId: string, name: string, input: Record<string, unknown>, agentId?: string): void
  onToolEnd(toolCallId: string, name: string, result: string, ok: boolean, agentId?: string): void
  /** Authenticated evidence emitted only after a tool executor returns. */
  onEvidence?(toolCallId: string, name: string, input: Record<string, unknown>, result: string, ok: boolean, provenance: ToolProvenance, source?: string): void
  onToolParked?(toolCallId: string, name: string, input: Record<string, unknown>, agentId?: string): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>, risk?: RiskLevel, reason?: string, agentId?: string): Promise<boolean>
  onSessionEnd(sessionId: string): void
  onStats?(tokens_in: number, tokens_out: number, cost_usd: number, context_tokens?: number, agentId?: string, usage?: UsageMetadata): void
  onAgentSpawn?(frame: AgentFrame, input: Record<string, unknown>, budget?: { max_cost_usd: number }): void
  onAgentState?(agentId: string, state: 'running' | 'waiting_approval' | 'waiting_input', tool?: string): void
  onAgentStats?(agentId: string, tokens_in: number, tokens_out: number, cost_usd: number, tools: number, usage?: UsageMetadata): void
  onAgentEnd?(agentId: string, status: 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'contract_violation', error?: string, output?: unknown, durationMs?: number): void
  onAgentMessage?(post: BulletinPost): void
  onNotice?(level: 'info' | 'warn' | 'error', message: string, detail?: string, agentId?: string): void
  onSafetyNotice?(model: string): void
  onArtifacts?(sessionId: string, artifacts: any[], agentId?: string): void
  onInputRequest?(id: string, prompt: string, kind: InputRequestKind, options?: string[], agentId?: string): Promise<string>
  onTodosUpdate?(todos: TodoItem[], agentId?: string): void
  onCodeExecute?(id: string, code: string, language: string, data?: Record<string, unknown>, agentId?: string): Promise<ExecutionResult>
  onRenderUI?(surface: SurfaceSpec, agentId?: string): Promise<SurfaceRenderResult>
  onStage?(stage: Stage, intensity: Intensity, tier: Tier, model: string, state: 'start' | 'done' | 'escalated' | 'skipped', cost_usd?: number, agentId?: string): void
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
  /** Legacy API client seam; Codex profiles leave this unset. */
  openai?: OpenAI
  provider?: ProviderClient
  /** Capabilities from the active provider catalog, keyed by model id. */
  modelCapabilities?: Record<string, EffortCapability>
  credentialGeneration?: string
  deadline?: number
  usageSink?: import('../provider/types.js').ModelUsageSink
  attemptLedger?: import('../provider/types.js').ModelAttemptLedger
  attemptBudget?: SharedAttemptBudget
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
  currentToolName?: string
  sourceCodeId?: string
  budget?: RunBudget
  unattended?: boolean
  taintSources?: string[]
  stage?: import('../workflow/types.js').StageTag
  agentFrame?: AgentFrame
  protocolVersion?: number
  agentOrigin?: AgentFrame['origin']
  agentControllers?: Map<string, AbortController>
  bulletin?: Bulletin
  missionId?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolReturn>
  /** Optional side-effect-free proposal. Preview never invokes execute. */
  preview?(input: Record<string, unknown>, context: ToolContext): Promise<import('../rehearsal/index.js').ActionProposal>
}
