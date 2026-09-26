export type TownTaskState =
  | 'draft'
  | 'ready'
  | 'queued_quota'
  | 'queued_dependency'
  | 'queued_workspace'
  | 'queued_concurrency'
  | 'dispatching'
  | 'running'
  | 'waiting_user'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type TownCraft = 'planner' | 'designer' | 'builder' | 'reviewer' | 'tester' | 'debugger' | 'researcher' | 'scribe' | 'guardian'
export type TownWorkspaceMode = 'read_only' | 'shared_checkout' | 'isolated_worktree'
export type TownProjectScanStatus = 'known' | 'unknown' | 'partial' | 'error'
export type TownQuotaStatus = 'available' | 'unavailable' | 'stale' | 'exhausted' | 'unsupported'

export interface TownSettings {
  revision: number
  discovery_root: string
  ignore_policy_version: number
  saved_viewpoints: Array<{ id: string; name: string; position: [number, number, number]; target: [number, number, number] }>
  pinned_project_ids: string[]
}

export interface TownDiscoverySummary {
  status: 'complete' | 'partial' | 'error'
  root: string
  scanned_at: string
  project_count: number
  skipped_count: number
  error_count: number
  warnings: string[]
}

export interface TownProjectSize {
  source: 'git_tracked_regular_files'
  status: 'complete' | 'partial' | 'unknown' | 'error'
  tracked_regular_files?: number
  measured_at: string
  max_entries: number
  error?: string
}

export interface TownProject {
  id: string
  path: string
  parent_id?: string
  remote?: string
  git: {
    head?: string
    dirty?: boolean
    last_commit_at?: string
    status: TownProjectScanStatus
    error?: string
  }
  scanned_at: string
  display: { name: string; description?: string }
  size?: TownProjectSize
}

export interface TownAgent {
  id: string
  profile: string
  role: string
  display_name: string
  home_project_id?: string
  lifecycle: 'persistent' | 'task_bound'
  state?: 'idle' | 'working' | 'waiting_user' | 'failed' | 'unknown'
  task_id?: string
  session_id?: string
  run_id?: string
  /** Artisan catalog key (ADR-91); absent on legacy task-bound agents. */
  persona?: string
  craft?: TownCraft
  retired_at?: string
  /** Last real tool start observed for this agent's live run (throttled). */
  last_activity_at?: string
  last_tool?: string
}

export interface TownTask {
  id: string
  project_id: string
  title: string
  prompt: string
  state: TownTaskState
  revision: number
  agent_id?: string
  /** Parent Town task that created this task through a bound runtime tool. */
  created_by_task_id?: string
  /** User-authorized, task-scoped exception to the automatic provider-capacity gate. */
  manual_quota_override?: {
    requested_at: string
    authorized_at: string
    authorized_by: string
    authority_task_id: string
    /** Distinguishes a fresh dispatch request from an explicit parked-answer retry. */
    authorization_scope?: 'dispatch' | 'answer_resume'
    quota_provider: string
    quota_status: TownQuotaStatus
    quota_source: string
  }
  depends_on: string[]
  workspace_mode: TownWorkspaceMode
  session_id?: string
  run_id?: string
  block_reason?: string
  terminal_evidence?: string
  created_at: string
  updated_at: string
}

export interface TownMessage {
  id: string
  project_id: string
  task_id?: string
  thread_id?: string
  from: string
  to: string
  kind: 'status' | 'question' | 'answer' | 'handoff'
  body: string
  options?: string[]
  artifact_ids: string[]
  reply_to?: string
  continuation_id?: string
  answer_key_hash?: string
  answer_outcome?: { resumed: boolean; state?: string; error?: string }
  state: 'delivered' | 'acknowledged'
  revision: number
  created_at: string
  acknowledged_at?: string
}

export interface QuotaWindow {
  limit_id?: string
  used_percent: number
  remaining_percent?: number
  window_minutes?: number
  resets_at?: string
  exhausted?: boolean
}

export interface QuotaSnapshot {
  provider: string
  account_scope: string
  status: TownQuotaStatus
  provider_reached?: boolean
  spend_control_reached?: boolean
  reached_type?: string
  fetched_at?: string
  expires_at?: string
  windows: QuotaWindow[]
  source: string
  last_error?: string
}

export interface DispatchLease {
  id: string
  kind: 'dispatch' | 'workspace'
  task_id: string
  project_id: string
  provider: string
  account_scope: string
  workspace_mode: TownWorkspaceMode
  acquired_at: string
  expires_at: string
  release_reason?: string
}

export interface TownEvent {
  cursor: number
  type: string
  occurred_at: string
  data: unknown
}

export interface TownSnapshot {
  cursor: number
  generated_at: string
  settings: TownSettings
  discovery: TownDiscoverySummary | null
  projects: TownProject[]
  agents: TownAgent[]
  tasks: TownTask[]
  messages: TownMessage[]
  quota: QuotaSnapshot
  resync?: boolean
}

export interface TownEventPage {
  cursor: number
  events: TownEvent[]
  resync?: boolean
}
