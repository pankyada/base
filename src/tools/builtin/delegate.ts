import { mergeUsageDelta } from '../../usage/ledger.js'
import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { homedir } from 'os'
import { ToolDefinition, ToolContext } from '../types.js'
import { loadProfile } from '../../profiles/loader.js'
import { createProviderClient } from '../../provider/client.js'
import { createProvider } from '../../provider/factory.js'
import { bindRunProvider } from '../../provider/invocation.js'
import { createMcpClients, destroyMcpClients } from '../../mcp/client.js'
import { createSession } from '../../session/store.js'
import { FsMemoryProvider } from '../../memory/fs-memory.js'
import { GraphMemoryProvider } from '../../memory/graph-memory.js'
import { MemoryProvider } from '../../memory/interface.js'
import { loadAllSkills, resolveSkillsDirs } from '../../skills/loader.js'
import { buildSkillIndex } from '../../skills/indexer.js'
import { runAgentLoop } from '../../loop/agent-loop.js'
import { createProfileMemoryCapture, createScopedDecisionRuntime } from '../../decisions/runtime.js'
import { createAgentFrame } from '../../agents/frames.js'
import { tagEvents } from '../../agents/events.js'

export function findProfilePath(name: string, profile?: { profile_path?: string }): string | null {
  const candidates = [
    ...(profile?.profile_path ? [resolve(dirname(profile.profile_path), `${name}.yaml`)] : []),
    resolve(homedir(), '.harness', 'profiles', `${name}.yaml`),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export const delegateTool: ToolDefinition = {
  name: 'Delegate',
  description: 'Delegate a task to a sub-agent running under a different profile. Returns the final reply and a summary of tools used.',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Target profile name (e.g. "data" or "coding")' },
      task: { type: 'string', description: 'Task description for the sub-agent' },
    },
    required: ['profile', 'task'],
  },
  async execute(input, context) {
    const { profile: profileName, task } = input as { profile: string; task: string }

    // Depth limit — match agents-as-tools and honor the active profile cap.
    const maxDepth = context.maxDepth ?? 2
    if ((context.delegateDepth ?? 0) >= maxDepth) {
      return `Error: cannot delegate from within a sub-agent (max depth is ${maxDepth}).`
    }

    // Profile discovery
    const profilePath = findProfilePath(profileName, context.profile)
    if (!profilePath) {
      return (
        `Error: profile "${profileName}" not found. ` +
        `Searched: sibling of the active profile, ~/.harness/profiles/${profileName}.yaml`
      )
    }

    try {
      const subProfile = loadProfile(profilePath)
      const subProvider = createProvider(subProfile)
      const subOpenai = subProfile.model.auth === 'codex_oauth' ? undefined : createProviderClient(subProfile)
      const subMcpEntries = await createMcpClients(subProfile)
      const childBudget = context.budget?.allocate(context.budget.remainingCost())

      const subSession = createSession(subProfile.name, context.session.user)
      try {
        const frame = createAgentFrame({
          agentName: profileName,
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
        const subMemory: MemoryProvider = subProfile.memory?.provider === 'graph'
          ? new GraphMemoryProvider(subProfile.artifact_dir, subSession)
          : new FsMemoryProvider(subProfile.artifact_dir, subSession)
        const subSkills = loadAllSkills(resolveSkillsDirs())
        const subDecisionRuntime = createScopedDecisionRuntime(subProfile, context.decisionRuntime)
        const subMemoryRecall = createProfileMemoryCapture(subProfile, subDecisionRuntime, context.signal, 'memory_recall')

        // Build system prompt for sub-agent
        const systemPromptBase = readFileSync(subProfile.system_prompt, 'utf-8')
        const skillIndex = buildSkillIndex(subSkills)
        const memSection = subMemoryRecall
          ? await subMemoryRecall.buildPromptSection(subMemory, task, subSession.project)
          : await subMemory.buildSystemPromptSection()
        subSession.messages.push({
          role: 'system',
          content: systemPromptBase + skillIndex + memSection,
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
          taintSources: context.taintSources,
          agentFrame: frame,
          protocolVersion: context.protocolVersion,
        }
        subContext.provider = bindRunProvider(subProvider, subContext)

        try {
          await runAgentLoop(
            task,
            subProfile,
            subSession,
            subContext,
            subEvents,
            subOpenai,
            context.signal,
            context.stage ? { stage: context.stage } : undefined,
          )

          if (context.signal?.aborted) {
            const error = `Error: delegate to "${profileName}" cancelled`
            subEvents.onAgentEnd?.(frame.agent_id, 'cancelled', error, undefined, Date.now() - startedAt)
            return error
          }

          // Extract final assistant text
          const messages = subSession.messages as Array<{ role: string; content?: string | null }>
          const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
          const finalText = lastAssistant?.content ?? '(no response)'

          // Build tool summary
          const toolCounts = new Map<string, number>()
          for (const tc of subSession.tool_calls) {
            toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1)
          }
          const toolSummary = toolCounts.size === 0
            ? 'Tools used: (none)'
            : 'Tools used: ' + [...toolCounts.entries()].map(([n, c]) => `${n} ×${c}`).join(', ')

          const output = `[Delegate: ${profileName}]\n${finalText}\n\n${toolSummary}`
          subEvents.onAgentEnd?.(frame.agent_id, 'completed', undefined, output, Date.now() - startedAt)
          return (subSession.taint_sources?.length ?? 0) > 0
            ? { content: output, provenance: 'untrusted' as const, source: subSession.taint_sources!.join('; ') }
            : output
        } catch (e: any) {
          const status = context.signal?.aborted || e?.name === 'AbortError' ? 'cancelled' : e?.name === 'BudgetExceeded' ? 'budget_exceeded' : 'failed'
          const error = `Error: delegate to "${profileName}" failed: ${e.message}`
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
      return `Error: delegate to "${profileName}" failed: ${e.message}`
    }
  },
}
