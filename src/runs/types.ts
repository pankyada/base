export interface Run {
  id: string
  profile: string
  user: string
  trigger: 'rest' | 'stream' | 'cron' | 'webhook'
  input: unknown
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  session_id?: string
  started_at: string
  finished_at?: string
  error?: string
}
