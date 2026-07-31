import { Project } from './projects/types.js'
import { SessionSummary } from './session/types.js'

export type AclValue = 'allow' | 'prompt' | 'deny'

export type InputRequestKind = 'text' | 'select' | 'multi_select'

export type ApprovalMode = 'strict' | 'bash' | 'danger' | 'yolo'
export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface ModelInfo {
  id: string
  label: string
  provider: string
  base_url: string
  context_window: number
  input_price: number
  output_price: number
  tags: string[]
  available: boolean
  reason?: string
}

export interface SkillSummary {
  name: string
  description: string
  path: string
  source: 'proposed' | 'installed'
  mtime: string
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}

export interface TelemetryEvent {
  ts: string
  session: string
  profile: string
  kind: 'tool' | 'skill' | 'mcp' | 'llm' | 'safety'
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

export type ClientMessage =
  | { type: 'hello'; user_id: string; wasm_supported?: boolean; yolo?: boolean }
  | { type: 'message'; content: string }
  | { type: 'cancel' }
  | { type: 'resume'; sessionId: string }
  | { type: 'tool_approve'; id: string }
  | { type: 'tool_deny'; id: string }
  | { type: 'input_response'; id: string; value: string }
  | { type: 'code_result'; id: string; stdout: string; stderr: string; exit_code: number; files: Record<string, string> }
  | { type: 'project_create'; name: string; description?: string }
  | { type: 'project_list' }
  | { type: 'project_assign'; sessionId: string; projectId: string }
  | { type: 'session_list'; projectId?: string }
  | { type: 'models_list' }
  | { type: 'set_model'; model: string }
  | { type: 'set_approval_mode'; mode: ApprovalMode }
  | { type: 'skills_list' }
  | { type: 'skill_get'; name: string; source: 'proposed' | 'installed' }
  | { type: 'skill_save'; name: string; content: string }
  | { type: 'skill_promote'; name: string }
  | { type: 'skill_discard'; name: string }
  | { type: 'skills_mine' }
  | { type: 'compact' }

export type ServerMessage =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'tool_prompt'; id: string; name: string; input: Record<string, unknown>; risk?: RiskLevel; reason?: string }
  | { type: 'session_ready'; sessionId: string; profile: string; model?: string; working_dir?: string; yolo: boolean }
  | { type: 'session_end'; sessionId: string }
  | { type: 'session_resumed'; sessionId: string }
  | { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number; context_window?: number; context_tokens?: number }
  | { type: 'error'; message: string }
  | { type: 'artifacts'; sessionId: string; artifacts: ArtifactWidget[] }
  | { type: 'input_request'; id: string; prompt: string; kind: InputRequestKind; options?: string[] }
  | { type: 'todos'; todos: TodoItem[] }
  | { type: 'code_execute'; id: string; code: string; language: string; data?: Record<string, unknown> }
  | { type: 'project_created'; project: Project }
  | { type: 'projects'; projects: Project[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'models'; models: ModelInfo[]; current: string }
  | { type: 'model_changed'; model: string }
  | { type: 'approval_mode_changed'; mode: ApprovalMode }
  | { type: 'skills'; proposed: SkillSummary[]; installed: SkillSummary[] }
  | { type: 'skill_content'; name: string; source: string; path: string; content: string }
  | { type: 'skill_result'; action: 'saved' | 'promoted' | 'discarded'; name: string; path?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string; detail?: string }

export type ArtifactKind = 'metrics' | 'bar' | 'line' | 'table' | 'filetree' | 'diff' | 'terminal' | 'doc' | 'research'

export interface ArtifactWidget {
  id: string
  kind: ArtifactKind
  title: string
  icon: string
  meta?: string
  data?: unknown
  [key: string]: unknown
}

export interface UIMessage {
  id: string;
  role: 'user' | 'agent' | 'tool-prompt' | 'tool-call';
  time?: string;
  content?: string;
  name?: string;
  input?: Record<string, unknown>;
  result?: string;
  status?: 'running' | 'done' | 'error';
  pending?: boolean;
}
