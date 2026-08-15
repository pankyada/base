import { Project } from './projects/types.js'
import { SessionSummary } from './session/types.js'
import type { PendingInput } from './runs/pending.js'
import type { Stage, Intensity, Tier, Reversibility } from './workflow/types.js'

export type AclValue = 'allow' | 'prompt' | 'deny'

export type InputRequestKind = 'text' | 'select' | 'multi_select'

export type ApprovalMode = 'strict' | 'bash' | 'danger' | 'yolo'
export type RiskLevel = 'safe' | 'caution' | 'danger'

/**
 * A unit of generated UI handed to a browser client for rendering inside an
 * isolated surface. The runtime never executes any of these fields — they are
 * opaque payloads forwarded to whatever sandbox the client provides.
 */
export interface SurfaceSpec {
  id: string
  title?: string
  mode: 'replace' | 'patch'
  html?: string
  css?: string
  js?: string
  python?: string
  data?: Record<string, unknown>
  open?: boolean
}

/** What the client reports back after attempting to render a SurfaceSpec. */
export interface SurfaceRenderResult {
  id: string
  ok: boolean
  errors: string[]
  stdout?: string
  duration_ms: number
  bytes: number
}

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

export interface CommandSummary {
  name: string
  description: string
  template: string
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
  kind: 'tool' | 'skill' | 'mcp' | 'llm' | 'safety' | 'stage' | 'outcome' | 'trigger'
  name?: string
  server?: string
  model?: string
  duration_ms?: number
  ok?: boolean
  tokens_in?: number
  tokens_out?: number
  cost_usd?: number
  trigger?: string
  source?: 'cron' | 'watch' | 'poll'
  task_id?: string
  stage_id?: string
  stage?: Stage | 'triage'
  attempt?: number
  intensity?: Intensity
  tier?: Tier
  task_class?: string
  blast_radius?: 'single-file' | 'module' | 'cross-module' | 'systemic'
  reversibility?: Reversibility
  playbook?: string
  escalated_from?: string
  explore?: boolean
  contract_ok?: boolean
  state?: 'start' | 'done' | 'escalated' | 'skipped'
  failed_back_to?: Stage
  verdict?: 'accepted' | 'reworked' | 'abandoned'
  stages_run?: number
  rework_count?: number
  escalations?: number
  verify_first_try?: boolean
  review_findings?: { high: number; med: number; low: number }
  total_cost_usd?: number
  reason?: string
  human_edit_churn?: number
  context_tokens_est?: number
  context_tokens_actual?: number
  calib_ratio?: number
  elided_count?: number
  elided_bytes?: number
  digest_calls?: number
  restore_calls?: number
  cache_read_tokens?: number
  fired?: boolean
  skip_reason?: 'cursor_unchanged' | 'overlap' | 'budget' | 'probe_error'
  probe_ms?: number
  coalesced_events?: number
}

export interface StageEvent extends Omit<TelemetryEvent, 'kind'> {
  kind: 'stage'
  stage: Stage
  stage_id: string
  tier: Tier
  intensity: Intensity
  attempt: number
  contract_ok: boolean
  state: 'start' | 'done' | 'escalated' | 'skipped'
}

export interface OutcomeEvent extends Omit<TelemetryEvent, 'kind'> {
  kind: 'outcome'
  task_id: string
  verdict: 'accepted' | 'reworked' | 'abandoned'
  stages_run: number
  rework_count: number
  escalations: number
  verify_first_try: boolean
  review_findings: { high: number; med: number; low: number }
  total_cost_usd: number
}

export const PROTOCOL_VERSION = 2

export type ClientMessage =
  | { type: 'hello'; user_id: string; protocol_version?: number; profile?: string; wasm_supported?: boolean; audio_supported?: boolean; yolo?: boolean }
  | { type: 'set_profile'; profile: string }
  | { type: 'audio_start'; codec: 'opus' | 'pcm16'; sample_rate: number }
  | { type: 'audio_end' }
  | { type: 'barge_in' }
  | { type: 'message'; content: string; skipWorkflow?: boolean }
  | { type: 'plan_request'; content: string }
  | { type: 'cancel' }
  | { type: 'resume'; sessionId: string }
  | { type: 'tool_approve'; id: string }
  | { type: 'tool_deny'; id: string }
  | { type: 'input_response'; id: string; value: string }
  | { type: 'code_result'; id: string; stdout: string; stderr: string; exit_code: number; files: Record<string, string> }
  | { type: 'ui_result'; id: string; ok: boolean; errors?: string[]; stdout?: string; duration_ms?: number; bytes?: number }
  | { type: 'project_create'; name: string; description?: string }
  | { type: 'project_list' }
  | { type: 'project_assign'; sessionId: string; projectId: string }
  | { type: 'session_list'; projectId?: string }
  | { type: 'models_list' }
  | { type: 'set_model'; model: string }
  | { type: 'set_approval_mode'; mode: ApprovalMode }
  | { type: 'skills_list' }
  | { type: 'commands_list' }
  | { type: 'skill_get'; name: string; source: 'proposed' | 'installed' }
  | { type: 'skill_save'; name: string; content: string }
  | { type: 'skill_promote'; name: string }
  | { type: 'skill_discard'; name: string }
  | { type: 'skills_mine' }
  | { type: 'compact' }
  | { type: 'pending_list' }
  | { type: 'pending_answer'; pending_id: string; value: string }
  | { type: 'undo_list' }
  | { type: 'undo_apply'; id: string; force?: boolean }

export type ServerMessage =
  | { type: 'turn_start'; run_id: string }
  | { type: 'token'; content: string; run_id?: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown>; run_id?: string }
  | { type: 'tool_end'; id: string; name: string; result: string; ok?: boolean; run_id?: string }
  | { type: 'tool_parked'; id: string; name: string; input: Record<string, unknown>; run_id?: string }
  | { type: 'tool_prompt'; id: string; name: string; input: Record<string, unknown>; risk?: RiskLevel; reason?: string; run_id?: string }
  | { type: 'session_ready'; sessionId: string; profile: string; model?: string; working_dir?: string; yolo: boolean; protocol_version?: number }
  | { type: 'session_end'; sessionId: string; run_id?: string }
  | { type: 'session_resumed'; sessionId: string }
  | { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number; context_window?: number; context_tokens?: number; run_id?: string }
  | { type: 'error'; message: string; run_id?: string }
  | { type: 'artifacts'; sessionId: string; artifacts: ArtifactWidget[]; run_id?: string }
  | { type: 'input_request'; id: string; prompt: string; kind: InputRequestKind; options?: string[]; run_id?: string }
  | { type: 'todos'; todos: TodoItem[]; run_id?: string }
  | { type: 'code_execute'; id: string; code: string; language: string; data?: Record<string, unknown>; run_id?: string }
  | { type: 'ui_render'; surface: SurfaceSpec; run_id?: string }
  | { type: 'project_created'; project: Project }
  | { type: 'projects'; projects: Project[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'models'; models: ModelInfo[]; current: string }
  | { type: 'model_changed'; model: string }
  | { type: 'approval_mode_changed'; mode: ApprovalMode }
  | { type: 'skills'; proposed: SkillSummary[]; installed: SkillSummary[] }
  | { type: 'commands'; commands: CommandSummary[] }
  | { type: 'skill_content'; name: string; source: string; path: string; content: string }
  | { type: 'skill_result'; action: 'saved' | 'promoted' | 'discarded'; name: string; path?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string; detail?: string; run_id?: string }
  | { type: 'stage'; stage: Stage; intensity: Intensity; tier: Tier; model: string; state: 'start' | 'done' | 'escalated' | 'skipped'; cost_usd?: number; run_id?: string }
  | { type: 'plan'; content: string }
  | { type: 'pending'; pending: PendingInput[] }
  | { type: 'undo_entries'; entries: UndoEntry[] }
  | { type: 'transcript_partial'; text: string; final: boolean }
  | { type: 'audio_out_start'; codec: 'opus' | 'pcm16'; sample_rate: number }
  | { type: 'audio_out_end'; reason: 'complete' | 'interrupted' | 'error' }

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

export interface UndoEntry {
  id: string
  ts: string
  tool: string
  target: string
  expires_at?: string
  available: boolean
  forceable: boolean
  applied: boolean
  reason?: string
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
