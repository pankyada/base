import type { ArtifactWidget } from './protocol'

export * from './protocol'

export type Artifact = ArtifactWidget

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
  artifacts: ArtifactWidget[]
}

export interface UIMessage {
  id: string
  /** Server-owned run link used to attach execution evidence to the originating turn. */
  runId?: string
  role: 'user' | 'agent' | 'tool-prompt' | 'tool-call'
  content?: string
  name?: string
  input?: Record<string, unknown>
  result?: string
  toolCallID?: string
  status?: 'running' | 'waiting' | 'done' | 'error'
  pending?: boolean
}
