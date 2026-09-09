import { readFileSync } from 'fs'
import { createProviderClient } from '../provider/client.js'
import { createProvider } from '../provider/factory.js'
import { bindRunProvider } from '../provider/invocation.js'
import type { ProviderClient } from '../provider/types.js'
import type { UsageMetadata } from '../provider/types.js'
import { SharedAttemptBudget } from '../provider/usage.js'
import { createMcpClients, destroyMcpClients } from '../mcp/client.js'
import { createSession, saveSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { buildSystemPrompt } from '../context/system-prompt.js'
import { loadAgentTools } from '../agents/loader.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { runWorkflow } from '../workflow/runner.js'
import { recordUsage } from '../usage/ledger.js'
import type { UsageDelta } from '../usage/ledger.js'
import { sanitizeUserId } from '../session/user-paths.js'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'
import type { ChannelRuntime } from '../channels/runtime.js'
import type { PendingStore } from '../runs/pending.js'
import { isParkSignal } from '../runs/park.js'
import { BudgetExceeded } from '../runs/budget.js'
import type { RunBudget } from '../runs/budget.js'
import { audit } from '../audit/journal.js'
import { createRootFrame } from '../agents/frames.js'
import type { AgentFrame } from '../types.js'

export interface RestUsage extends Partial<UsageMetadata> {
  tokens_in: number
  tokens_out: number
  cost_usd: number
}

export interface RunProfileResult {
  finalText: string
  usage: RestUsage
  session: Session
}

export interface RunProfileOptions {
  profile: Profile
  userId: string
  userMessage: string
  events: AgentLoopEvents
  signal?: AbortSignal
  channels?: ChannelRuntime
  runId?: string
  pendingInputs?: PendingStore
  session?: Session
  resume?: { toolCallId: string; answer: string }
  appendUser?: boolean
  unattended?: boolean
  resumeApproval?: { toolCallId: string; approved: boolean; name: string; input: Record<string, unknown>; isMcp: boolean }
  budget?: RunBudget
  initialTaintSources?: string[]
  agentFrame?: AgentFrame
  protocolVersion?: number
  /** Test/runtime seam for an already resolved provider; production builds it from profile. */
  provider?: ProviderClient
}

function usageDeltaFromSession(before: Session['usage'], after: Session['usage']): UsageDelta {
  const delta: UsageDelta = {
    input: after.input - before.input,
    output: after.output - before.output,
    cost_usd: after.cost_usd - before.cost_usd,
  }
  for (const key of ['api_estimate_usd', 'api_equivalent_usd', 'cached_input_tokens', 'reasoning_output_tokens', 'model_attempts'] as const) {
    if (before[key] !== undefined || after[key] !== undefined) delta[key] = (after[key] ?? 0) - (before[key] ?? 0)
  }
  if (after.billed_cost_usd !== undefined) delta.billed_cost_usd = after.billed_cost_usd === null ? null : after.billed_cost_usd - (before.billed_cost_usd ?? 0)
  for (const key of ['billing_mode', 'cost_basis', 'usage_status'] as const) if (after[key] !== undefined) (delta as unknown as Record<string, unknown>)[key] = after[key]
  return delta
}

/** One-shot root run of a profile: build context, run the loop, extract final text + usage. */
export async function runProfileOnce(opts: RunProfileOptions): Promise<RunProfileResult> {
  const { profile, userMessage, events, signal, channels } = opts
  const user = sanitizeUserId(opts.userId)
  const provider: ProviderClient = opts.provider ?? createProvider(profile)
  const openai = profile.model.auth === 'codex_oauth' ? undefined : createProviderClient(profile)
  const attemptBudget = new SharedAttemptBudget(profile.model.auth === 'codex_oauth' ? profile.model.codex.max_model_calls_per_run : 1024)
  const mcpEntries = await createMcpClients(profile)
  const session = opts.session ?? createSession(profile.name, user)
  const usageBefore = { ...session.usage }

  try {
    const memory = profile.memory?.provider === 'graph'
      ? new GraphMemoryProvider(profile.artifact_dir, session)
      : new FsMemoryProvider(profile.artifact_dir, session)
    const skills = loadAllSkills(resolveSkillsDirs())
    const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')
    const skillIndex = buildSkillIndex(skills)
    if (session.messages.length === 0) {
      session.messages.push({
        role: 'system',
        content: await buildSystemPrompt({ profile, systemPromptBase, skillIndex, memory, onDiagnostics: diagnostics => {
          if (process.env.HARNESS_DIAGNOSTICS === '1') console.info(`[diagnostics] prompt assembly ${JSON.stringify(diagnostics)}`)
        } }),
      })
    }

    if (opts.resume) {
      const hasAnswer = session.messages.some((message: any) =>
        message?.role === 'tool' && message.tool_call_id === opts.resume!.toolCallId)
      if (!hasAnswer) {
        session.messages.push({ role: 'tool', tool_call_id: opts.resume.toolCallId, content: opts.resume.answer } as any)
      }
    }

    const agentTools = await loadAgentTools(profile)
    const context: ToolContext = {
      profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
      events, openai, provider, attemptBudget, signal, delegateDepth: 0, agentTools, maxDepth: profile.max_depth ?? 2, channels,
      pendingInputs: opts.pendingInputs, runId: opts.runId, unattended: opts.unattended, budget: opts.budget, taintSources: opts.initialTaintSources,
      agentFrame: opts.agentFrame ?? createRootFrame(profile.name, session.id),
      protocolVersion: opts.protocolVersion,
    }
    context.provider = bindRunProvider(provider, context)

    if (profile.workflow?.enabled) {
      await runWorkflow(userMessage, profile, session, context, events, openai as any, signal)
    } else {
      await runAgentLoop(userMessage, profile, session, context, events, openai, signal, {
        appendUser: opts.appendUser ?? true,
        resumeApproval: opts.resumeApproval,
      })
    }

    const messages = session.messages as Array<{ role: string; content?: string | null }>
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
    const finalText = lastAssistant?.content ?? ''

    const delta = usageDeltaFromSession(usageBefore, session.usage)
    recordUsage(user, delta)

    return {
      finalText,
      usage: {
        tokens_in: delta.input,
        tokens_out: delta.output,
        cost_usd: delta.cost_usd,
        billing_mode: delta.billing_mode,
        cost_basis: delta.cost_basis,
        billed_cost_usd: delta.billed_cost_usd,
        api_estimate_usd: delta.api_estimate_usd,
        api_equivalent_usd: delta.api_equivalent_usd,
        usage_status: delta.usage_status,
        cached_input_tokens: delta.cached_input_tokens,
        reasoning_output_tokens: delta.reasoning_output_tokens,
        model_attempts: delta.model_attempts,
      },
      session,
    }
  } catch (error) {
    {
      if (isParkSignal(error)) error.sessionId = session.id
      const delta = usageDeltaFromSession(usageBefore, session.usage)
      const hasUsage = delta.input !== 0 || delta.output !== 0 || delta.cost_usd !== 0 || (delta.model_attempts ?? 0) > 0
      if (hasUsage || isParkSignal(error) || error instanceof BudgetExceeded) {
        saveSession(session)
        recordUsage(user, delta)
      }
    }
    if (error instanceof BudgetExceeded) {
      audit({
        run_id: opts.runId,
        session_id: session.id,
        user,
        profile: profile.name,
        tool: error.in_flight,
        input: { budget_reason: error.reason, spent: error.spent, limit: error.limit },
        effect: 'destructive',
        decision: 'deny',
        decided_by: 'gate',
        decided_reason: `autonomy budget exceeded before ${error.in_flight}: ${error.reason}`,
        tainted: (session.taint_sources?.length ?? 0) > 0,
        ok: false,
      })
      await channels?.send(user, undefined, {
        text: `Run stopped: autonomy budget exceeded (${error.reason}). Spent ${error.spent.cost_usd.toFixed(4)} USD, ${error.spent.tools} tools, ${error.spent.wall_s.toFixed(1)}s; in flight: ${error.in_flight}.`,
        urgency: 'high',
      }).catch(() => {})
    }
    throw error
  } finally {
    await destroyMcpClients(mcpEntries).catch(() => {})
  }
}
