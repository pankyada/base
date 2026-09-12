// Generated from src/types.ts by scripts/gen-web-protocol.mjs. Do not edit.

export interface Project { id: string; user: string; name: string; created_at: string; description?: string }
export interface SessionSummary { id: string; project: string; title?: string; summary?: string; created_at: string; usage: { input: number; output: number; cost_usd: number } & UsageMetadataWire }
export interface PendingInput { id: string; run_id: string; session_id: string; user: string; profile: string; prompt: string; kind: 'text' | 'select' | 'multi_select'; options?: string[]; created_at: string; expires_at: string; state: string }
export type Stage = 'recon' | 'plan' | 'design' | 'build' | 'verify' | 'review'
export type Intensity = 0 | 1 | 2 | 3
export type Tier = 'cheap' | 'balanced' | 'frontier' | 'critic'
export type Reversibility = 'easy' | 'hard' | 'irreversible'


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
  effort?: EffortCapability
}

export interface EffortCapability {
  status: 'supported' | 'unsupported' | 'unknown'
  options: Array<{ value: string; label: string; description?: string; selectable: boolean; unavailable_reason?: string }>
  provider_default?: string
  source: 'live' | 'documented' | 'cache'
  checked_at: string
  stale: boolean
  /** Server-owned scope; account identity is represented only by opaque hash. */
  scope?: { transport: string; endpoint: string; provider_scope: string }
}

export interface ProfileInfo {
  name: string
  description?: string
  mode?: 'developer' | 'analyst' | 'assistant' | 'production'
}

export interface ProviderStatus {
  auth: 'api_key' | 'codex_oauth'
  status: 'active' | 'expired' | 'reauth_required' | 'missing' | 'disabled' | 'error'
}

export interface UsageMetadataWire {
  billing_mode?: 'api' | 'subscription' | 'mixed'
  cost_basis?: 'api_estimate' | 'api_equivalent' | 'legacy_estimate' | 'mixed'
  billed_cost_usd?: number | null
  api_estimate_usd?: number
  api_equivalent_usd?: number
  usage_status?: 'complete' | 'partial' | 'estimated' | 'unknown'
  cached_input_tokens?: number
  reasoning_output_tokens?: number
  model_attempts?: number
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

export interface AgentFrame {
  agent_id: string
  agent_name: string
  parent_agent_id: string
  depth: number
  origin: 'model' | 'operator'
  profile: string
  session_id: string
}

export interface AgentCatalogEntry {
  name: string
  profile: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  label?: string
  hint?: string
  prompt_field?: string
  example?: Record<string, unknown>
  max_concurrent?: number
  budget_usd?: number
}

export const PROTOCOL_VERSION = 4

export interface BulletinPostWire {
  id: string
  seq: number
  from_agent_id: string
  from_agent_name: string
  to: 'all' | string[]
  kind: 'post' | 'ask' | 'answer' | 'handoff' | 'standup'
  subject: string
  body_preview: string
  artifact_ids?: string[]
  tainted: boolean
  ts: number
}

export interface SessionRuntimeWire {
  session_id: string
  user: string
  revision: number
  status: 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'
  last_seq: number
  controller?: { id: string; expires_at: number }
  events: Array<{ seq: number; type: string; payload: unknown; at: string }>
  gap: boolean
  run_id?: string
  latest_usage?: unknown
  budget?: unknown
  actionable_ids?: string[]
  actionable?: Array<{ id: string; name: string; input: Record<string, unknown>; risk?: RiskLevel; reason?: string; preview?: unknown; agent_id?: string; run_id?: string }>
  recovery_incomplete?: boolean
}

export interface MissionWire {
  id: string
  status: 'open' | 'execution_finished' | 'accepted' | 'failed' | 'needs_human'
  revision: number
  outcome: string
  criteria: Array<{ id: string; description: string; state: 'pending' | 'verified' | 'failed' | 'needs_human' }>
}

export interface ChallengeWire {
  id: string
  mission_id: string
  criterion_id?: string
  challenger: string
  question: string
  state: 'open' | 'addressed' | 'unresolved'
  round: number
  cost_usd: number
  evidence_count: number
  resolution_evidence_count: number
}

export type ClientMessage =
  | { type: 'hello'; user_id?: string; protocol_version?: number; profile?: string; wasm_supported?: boolean; audio_supported?: boolean; yolo?: boolean /** Ignored: approval mode is server-authoritative. */ }
  | { type: 'set_profile'; profile: string }
  | { type: 'audio_start'; codec: 'opus' | 'pcm16'; sample_rate: number }
  | { type: 'audio_end' }
  | { type: 'barge_in' }
  | { type: 'message'; content: string; skipWorkflow?: boolean }
  | { type: 'plan_request'; content: string }
  | { type: 'cancel' }
  | { type: 'resume'; sessionId: string }
  | { type: 'tool_approve'; id: string; remember?: boolean; request_id?: string }
  | { type: 'tool_deny'; id: string; request_id?: string }
  | { type: 'input_response'; id: string; value: string; request_id?: string }
  | { type: 'code_result'; id: string; stdout: string; stderr: string; exit_code: number; files: Record<string, string>; request_id?: string }
  | { type: 'ui_result'; id: string; ok: boolean; errors?: string[]; stdout?: string; duration_ms?: number; bytes?: number; request_id?: string }
  | { type: 'project_create'; name: string; description?: string }
  | { type: 'project_list' }
  | { type: 'project_assign'; sessionId: string; projectId: string }
  | { type: 'session_list'; projectId?: string }
  | { type: 'models_list' }
  | { type: 'set_model'; model: string; effort?: string | null; request_id?: string }
  | { type: 'profiles_list' }
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
  | { type: 'pending_answer'; pending_id: string; value: string; request_id?: string }
  | { type: 'undo_list' }
  | { type: 'undo_apply'; id: string; force?: boolean; reason?: string }
  | { type: 'spawn'; agent: string; input: Record<string, unknown>; count?: number; budget_usd?: number }
  | { type: 'agent_cancel'; agent_id: string }
  | { type: 'agents_list' }
  | { type: 'board_post'; subject: string; body: string; to?: string[] }
  | { type: 'attach'; session_id: string; mode: 'observe' | 'control'; request_id?: string }
  | { type: 'runtime_subscribe'; session_id: string; after_seq?: number; request_id?: string }
  | { type: 'mission_list' }
  | { type: 'mission_create'; outcome: string; constraints?: string[]; criteria: Array<{ id: string; description: string; kind: string; expected?: unknown }> }
  | { type: 'mission_human'; mission_id: string; criterion_id: string; revision: number }
  | { type: 'challenge_list'; mission_id?: string }
  | { type: 'challenge_open'; mission_id: string; criterion_id?: string; question: string }
  | { type: 'challenge_answer'; challenge_id: string; unresolved?: boolean; note?: string; evidence?: unknown[] }

export type ServerMessage =
  | { type: 'turn_start'; agent_id?: string; run_id: string }
  | { type: 'token'; content: string; agent_id?: string; run_id?: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown>; agent_id?: string; run_id?: string }
  | { type: 'tool_end'; id: string; name: string; result: string; ok?: boolean; agent_id?: string; run_id?: string }
  | { type: 'tool_parked'; id: string; name: string; input: Record<string, unknown>; agent_id?: string; run_id?: string }
  | { type: 'tool_prompt'; id: string; name: string; input: Record<string, unknown>; risk?: RiskLevel; reason?: string; preview?: unknown; agent_id?: string; run_id?: string }
  | { type: 'tool_auto_approved'; id: string; name: string; scope: 'session'; agent_id?: string; run_id?: string }
  | { type: 'session_ready'; sessionId: string; profile: string; model?: string; effort?: string | null; working_dir?: string; allowed_packages?: string[]; budget?: { max_cost_usd: number }; yolo: boolean; protocol_version?: number; provider_status?: ProviderStatus; capabilities?: { runtime_recovery?: boolean; correlated_decisions?: boolean; model_effort_selection?: boolean } }
  | { type: 'session_end'; sessionId: string; agent_id?: string; run_id?: string; status?: 'completed' | 'budget_exceeded' | 'cancelled' | 'failed'; reason?: string }
  // `profile` is required: the server always resolves a concrete post-resume profile
  // (the resumed session's own profile, falling back to the connection's profile) before
  // this message is ever sent, so there is no emitter that genuinely cannot know it.
  | { type: 'session_resumed'; agent_id?: string; sessionId: string; profile: string }
  | { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number; context_window?: number; context_tokens?: number; usage?: UsageMetadataWire; agent_id?: string; run_id?: string }
  | { type: 'error'; message: string; request_id?: string; agent_id?: string; run_id?: string }
  | { type: 'artifacts'; sessionId: string; artifacts: ArtifactWidget[]; agent_id?: string; run_id?: string }
  | { type: 'input_request'; id: string; prompt: string; kind: InputRequestKind; options?: string[]; agent_id?: string; run_id?: string }
  | { type: 'todos'; todos: TodoItem[]; agent_id?: string; run_id?: string }
  | { type: 'code_execute'; id: string; code: string; language: string; data?: Record<string, unknown>; agent_id?: string; run_id?: string }
  | { type: 'ui_render'; surface: SurfaceSpec; agent_id?: string; run_id?: string }
  | { type: 'agent_spawn'; frame: AgentFrame; input: Record<string, unknown>; budget?: { max_cost_usd: number }; run_id?: string }
  | { type: 'agent_state'; agent_id: string; state: 'running' | 'waiting_approval' | 'waiting_input'; tool?: string; run_id?: string }
  | { type: 'agent_stats'; agent_id: string; tokens_in: number; tokens_out: number; cost_usd: number; tools: number; usage?: UsageMetadataWire; run_id?: string }
  | { type: 'agent_end'; agent_id: string; status: 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'contract_violation'; error?: string; output?: unknown; duration_ms: number; run_id?: string }
  | { type: 'agent_catalog'; agents: AgentCatalogEntry[] }
  | { type: 'agent_message'; post: BulletinPostWire; run_id?: string }
  | { type: 'standup'; standup_id: string; phase: 'open' | 'answered' | 'closed'; subject: string; expected: string[]; answered: string[]; run_id?: string }
  | { type: 'fleet_snapshot'; frames: AgentFrame[]; states: { agent_id: string; tool?: string; since: number; state: 'running' | 'waiting_approval' | 'waiting_input'; spend_usd: number; tools: number }[]; board: BulletinPostWire[]; stage?: Stage; queue: { id: string; kind: 'tool_prompt' | 'input_request'; agent_id?: string }[]; feed?: string[]; run_id?: string }
  | { type: 'runtime'; snapshot: SessionRuntimeWire; request_id?: string }
  | { type: 'mission'; mission: MissionWire; receipts?: unknown[] }
  | { type: 'receipt'; receipt: unknown }
  | { type: 'challenge'; challenge: ChallengeWire }
  | { type: 'project_created'; project: Project }
  | { type: 'projects'; projects: Project[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'models'; models: ModelInfo[]; current: string; effort?: string | null; request_id?: string }
  | { type: 'profiles'; profiles: ProfileInfo[]; current: string }
  | { type: 'model_changed'; model: string; effort?: string | null; request_id?: string }
  | { type: 'approval_mode_changed'; mode: ApprovalMode }
  | { type: 'skills'; proposed: SkillSummary[]; installed: SkillSummary[] }
  | { type: 'commands'; commands: CommandSummary[] }
  | { type: 'skill_content'; name: string; source: string; path: string; content: string }
  | { type: 'skill_result'; action: 'saved' | 'promoted' | 'discarded'; name: string; path?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string; detail?: string; request_id?: string; agent_id?: string; run_id?: string }
  | { type: 'stage'; stage: Stage; intensity: Intensity; tier: Tier; model: string; state: 'start' | 'done' | 'escalated' | 'skipped'; cost_usd?: number; agent_id?: string; run_id?: string }
  | { type: 'plan'; content: string; agent_id?: string; run_id?: string }
  | { type: 'pending'; pending: PendingInput[] }
  | { type: 'pending_result'; pending_id: string; status: 'answered' | 'ignored' | 'failed'; error?: string; request_id?: string }
  | { type: 'undo_entries'; entries: UndoEntry[] }
  | { type: 'transcript_partial'; text: string; final: boolean }
  | { type: 'audio_out_start'; codec: 'opus' | 'pcm16'; sample_rate: number }
  | { type: 'audio_out_end'; reason: 'complete' | 'interrupted' | 'error' }

export type ArtifactKind = 'metrics' | 'bar' | 'line' | 'area' | 'scatter' | 'histogram' | 'heatmap' | 'box' | 'correlation' | 'table' | 'filetree' | 'diff' | 'terminal' | 'doc' | 'research'

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
