import { mergeUsageDelta } from '../usage/ledger.js'
import { readFileSync } from 'fs'
import type { ValidateFunction } from 'ajv'
import { parseJsonContract } from '../shared/json-contract.js'
import { loadProfile } from '../profiles/loader.js'
import { createProviderClient } from '../provider/client.js'
import { createProvider } from '../provider/factory.js'
import { bindRunProvider } from '../provider/invocation.js'
import { createMcpClients, destroyMcpClients } from '../mcp/client.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { buildSystemPrompt } from '../context/system-prompt.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import type { ToolContext } from '../tools/types.js'
import { createProfileMemoryCapture, createScopedDecisionRuntime } from '../decisions/runtime.js'
import { createAgentFrame } from './frames.js'
import { tagEvents } from './events.js'

export interface SubAgentParams {
  agentName: string
  subProfilePath: string
  inputValidator: ValidateFunction
  outputValidator: ValidateFunction
  outputSchema: Record<string, unknown>
  input: Record<string, unknown>
  context: ToolContext
}

export async function runSubAgent(params: SubAgentParams): Promise<string> {
  const { agentName, subProfilePath, inputValidator, outputValidator, outputSchema, input, context } = params

  // 1. Input validation
  if (!inputValidator(input)) {
    const errs = (inputValidator.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ')
    return `Error: input validation failed for agent "${agentName}": ${errs}`
  }

  // 2. Depth check
  const maxDepth = context.maxDepth ?? 2
  if ((context.delegateDepth ?? 0) >= maxDepth) {
    return `Error: max delegation depth (${maxDepth}) reached, cannot delegate to "${agentName}"`
  }

  // 3. Task serialisation — append output format instruction to user message
  const userMessage =
    `${JSON.stringify(input, null, 2)}\n\n` +
    `Respond with a JSON object matching this schema: ${JSON.stringify(outputSchema)}`

  // 4. Run sub-agent
  try {
    const subProfile = loadProfile(subProfilePath)
    const subProvider = createProvider(subProfile)
    const subOpenai = subProfile.model.auth === 'codex_oauth' ? undefined : createProviderClient(subProfile)
    const subMcpEntries = await createMcpClients(subProfile)
    const childBudget = context.budget?.allocate(context.budget.remainingCost())

    const subSession = createSession(subProfile.name, context.session.user)
    try {
      const frame = createAgentFrame({
        agentName,
        parent: context.agentFrame,
        profile: subProfile.name,
        sessionId: subSession.id,
        depth: (context.delegateDepth ?? 0) + 1,
        origin: context.agentOrigin ?? 'model',
      })
      const subEvents = tagEvents(context.events, frame, context.protocolVersion)
      const startedAt = Date.now()
      if (childBudget) subEvents.onAgentSpawn?.(frame, input, { max_cost_usd: childBudget.config.max_cost_usd })
      else subEvents.onAgentSpawn?.(frame, input)
      subEvents.onAgentState?.(frame.agent_id, 'running')
      const subMemory =
        subProfile.memory?.provider === 'graph'
          ? new GraphMemoryProvider(subProfile.artifact_dir, subSession)
          : new FsMemoryProvider(subProfile.artifact_dir, subSession)
      const subSkills = loadAllSkills(resolveSkillsDirs())
      const subDecisionRuntime = createScopedDecisionRuntime(subProfile, context.decisionRuntime)
      const subMemoryRecall = createProfileMemoryCapture(subProfile, subDecisionRuntime, context.signal, 'memory_recall')
      const systemPromptBase = readFileSync(subProfile.system_prompt, 'utf-8')
      const skillIndex = buildSkillIndex(subSkills)
      subSession.messages.push({
        role: 'system',
        content: await buildSystemPrompt({ profile: subProfile, systemPromptBase, skillIndex, memory: subMemory, memoryRecall: subMemoryRecall, memoryRecallQuery: userMessage, memoryProject: subSession.project }),
      })

      const subContext: ToolContext = {
        profile: subProfile,
        session: subSession,
        workingDir: subProfile.working_dir,
        memory: subMemory,
        skills: subSkills,
        mcpEntries: subMcpEntries,
        events: subEvents,
        openai: subOpenai,
        provider: subProvider,
        decisionRuntime: subDecisionRuntime,
        memoryRecall: subMemoryRecall,
        attemptBudget: context.attemptBudget,
        deadline: context.deadline,
        usageSink: context.usageSink,
        signal: context.signal,
        delegateDepth: (context.delegateDepth ?? 0) + 1,
        maxDepth,
        budget: childBudget,
        agentTools: [], // sub-agents don't inherit parent's agent registry
        taintSources: context.taintSources,
        agentFrame: frame,
        protocolVersion: context.protocolVersion,
      }
      subContext.provider = bindRunProvider(subProvider, subContext)

      try {
        await runAgentLoop(
          userMessage,
          subProfile,
          subSession,
          subContext,
          subEvents,
          subOpenai,
          context.signal,
          context.stage ? { stage: context.stage } : undefined,
        )

        if (context.signal?.aborted) {
          const error = `Error: agent "${agentName}" cancelled`
          subEvents.onAgentEnd?.(frame.agent_id, 'cancelled', error, undefined, Date.now() - startedAt)
          return error
        }

        // 5–6. Output parsing + validation (shared util)
        const messages = subSession.messages as Array<{ role: string; content?: string | null }>
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
        const raw = lastAssistant?.content ?? ''
        const result = parseJsonContract(raw, outputValidator)
        if (!result.ok) {
          const error = `Error: agent "${agentName}" ${result.error}`
          subEvents.onAgentEnd?.(frame.agent_id, 'contract_violation', error, undefined, Date.now() - startedAt)
          return error
        }

        const output = result.value
        subEvents.onAgentEnd?.(frame.agent_id, 'completed', undefined, output, Date.now() - startedAt)
        return JSON.stringify(output)
      } catch (e: any) {
        const status = context.signal?.aborted || e?.name === 'AbortError'
          ? 'cancelled'
          : e?.name === 'BudgetExceeded'
            ? 'budget_exceeded'
            : 'failed'
        const error = `Error: agent "${agentName}" failed: ${e.message}`
        subEvents.onAgentEnd?.(frame.agent_id, status, error, undefined, Date.now() - startedAt)
        throw e
      }
    } finally {
      await destroyMcpClients(subMcpEntries).catch(() => {})
      mergeUsageDelta(context.session.usage, subSession.usage)
      if (context.budget && childBudget) context.budget.absorbChildUsage(childBudget, subSession.usage.cost_usd)
      childBudget?.release()
    }
  } catch (e: any) {
    return `Error: agent "${agentName}" failed: ${e.message}`
  }
}
