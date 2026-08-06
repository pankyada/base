export interface Run {
  id: string
  profile: string
  user: string
  trigger: 'rest' | 'stream' | 'cron' | 'watch' | 'poll' | 'webhook' | 'a2a' | 'acp'
  input: unknown
  status: 'pending' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'budget_exceeded' | 'cancelled'
  session_id?: string
  started_at: string
  finished_at?: string
  error?: string
}
