import type OpenAI from 'openai'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { runWorkflow } from '../workflow/runner.js'

export interface InteractiveTurnDeps {
  runAgentLoop: typeof runAgentLoop
  runWorkflow: typeof runWorkflow
}

const defaultDeps: InteractiveTurnDeps = { runAgentLoop, runWorkflow }

/** Approval re-injection is one ordinary turn and must not start a second workflow. */
export async function runInteractiveTurn(
  request: string,
  profile: Profile,
  session: Session,
  context: ToolContext,
  events: AgentLoopEvents,
  openai: OpenAI,
  signal: AbortSignal,
  skipWorkflow = false,
  deps: InteractiveTurnDeps = defaultDeps,
): Promise<void> {
  if (profile.workflow?.enabled && !skipWorkflow) {
    await deps.runWorkflow(request, profile, session, context, events, openai, signal)
    return
  }
  await deps.runAgentLoop(request, profile, session, context, events, openai, signal)
}

export async function runApprovedPlanFollowOn(
  request: string,
  planBody: string,
  persistPlan: () => void,
  followOn: (approvedMessage: string) => Promise<void> | void,
): Promise<void> {
  persistPlan()
  await followOn(`${request}\n\nApproved plan:\n${planBody}`)
}
