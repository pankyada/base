export type AclValue = 'allow' | 'prompt' | 'deny'

export type InputRequestKind = 'text' | 'select' | 'multi_select'

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

export type ServerMessage =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'tool_prompt'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'session_ready'; sessionId: string; profile: string; yolo: boolean }
  | { type: 'session_end'; sessionId: string }
  | { type: 'session_resumed'; sessionId: string }
  | { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number; context_window?: number }
  | { type: 'error'; message: string }
  | { type: 'artifacts'; sessionId: string; artifacts: Artifact[] }
  | { type: 'input_request'; id: string; prompt: string; kind: InputRequestKind; options?: string[] }
  | { type: 'todos'; todos: TodoItem[] }
  | { type: 'code_execute'; id: string; code: string; language: string; data?: Record<string, unknown> }
  | { type: 'project_created'; project: Project }
  | { type: 'projects'; projects: Project[] }
  | { type: 'sessions'; sessions: SessionSummary[] }

export type ArtifactKind = 'metrics' | 'bar' | 'line' | 'table' | 'filetree' | 'diff' | 'terminal' | 'doc' | 'research'

export interface Artifact {
  id: string
  kind: ArtifactKind
  title: string
  icon: string
  meta?: string
  data?: unknown
  [key: string]: unknown
}

export interface ExecutionResult {
  id: string
  stdout: string
  stderr: string
  exit_code: number
  files: Record<string, string>
  duration_ms: number
}

export interface WorkspaceTab {
  id: string
  label: string
  icon: string
  artifacts: Artifact[]
}

export interface Project {
  id: string
  user: string
  name: string
  created_at: string
}

export interface SessionSummary {
  id: string
  project: string
  title?: string
  summary?: string
  created_at: string
  usage: { input: number; output: number; cost_usd: number }
}

export interface UIMessage {
  id: string;
  role: 'user' | 'agent' | 'tool-prompt' | 'tool-call';
  content?: string;
  name?: string;
  input?: Record<string, unknown>;
  result?: string;
  status?: 'running' | 'done' | 'error';
  pending?: boolean;
}
