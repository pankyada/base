export interface SessionToolCall {
  id?: string
  name: string
  input: Record<string, unknown>
  result: string
  ok: boolean
  ts: string
}

export interface ContextState {
  pins: Array<{ key: string; text: string }>
  /** Jev-selected source groups; explicit pins remain in `pins` and always render first. */
  supplemental_pins?: Array<{ key: string; text: string; source_revision: string; created_at: string }>
  digest?: { upto: number; text: string }
  calib: { ratio: number; samples: number }
}

import type { TodoItem } from '../types.js'
import type { UsageMetadata } from '../provider/types.js'

export interface SessionUsage extends UsageMetadata { input: number; output: number; cost_usd: number }

export interface Session {
  id: string
  /** Monotonic local revision. Legacy sessions may omit it. */
  revision?: number
  updated_at?: string
  user: string
  profile: string
  project: string
  /** Canonical project directory owned by this interactive session; legacy records may omit it. */
  working_dir?: string
  title?: string
  summary?: string
  created_at: string
  messages: unknown[]
  context?: ContextState
  tool_calls: SessionToolCall[]
  usage: SessionUsage
  session_memory: Record<string, string>
  todos: TodoItem[]
  /** Monotonic within a turn. Reset only when a genuine human message starts one. */
  taint_sources?: string[]
}

export function ensureContextState(session: Session): ContextState {
  if (!session.context) {
    session.context = {
      pins: [],
      calib: { ratio: 1, samples: 0 },
    }
  } else {
    session.context.pins ??= []
    session.context.calib ??= { ratio: 1, samples: 0 }
    session.context.calib.ratio ??= 1
    session.context.calib.samples ??= 0
  }
  return session.context
}

export interface SessionSummary {
  id: string
  project: string
  title?: string
  summary?: string
  created_at: string
  usage: SessionUsage
}
