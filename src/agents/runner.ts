import { readFileSync } from 'fs'
import type { ValidateFunction } from 'ajv'
import { parseJsonContract } from '../shared/json-contract.js'
import { loadProfile } from '../profiles/loader.js'
import { createProviderClient } from '../provider/client.js'
import { createMcpClients, destroyMcpClients } from '../mcp/client.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { buildSystemPrompt } from '../context/system-prompt.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import type { ToolContext, AgentLoopEvents } from '../tools/types.js'

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
    const subOpenai = createProviderClient(subProfile)
    const subMcpEntries = await createMcpClients(subProfile)

    try {
      const subSession = createSession(subProfile.name, context.session.user)
      const subMemory =
        subProfile.memory?.provider === 'graph'
          ? new GraphMemoryProvider(subProfile.artifact_dir, subSession)
          : new FsMemoryProvider(subProfile.artifact_dir, subSession)
      const subSkills = loadAllSkills(resolveSkillsDirs())
      const systemPromptBase = readFileSync(subProfile.system_prompt, 'utf-8')
      const skillIndex = buildSkillIndex(subSkills)
      subSession.messages.push({
        role: 'system',
        content: await buildSystemPrompt({ profile: subProfile, systemPromptBase, skillIndex, memory: subMemory }),
      })

      const subEvents: AgentLoopEvents = {
        onToken: t => context.events.onToken(t),
        onToolStart: (id, n, i) => context.events.onToolStart(id, n, i),
        onToolEnd: (id, n, r, ok) => context.events.onToolEnd(id, n, r, ok),
        onToolPrompt: (id, n, i) => context.events.onToolPrompt(id, n, i),
        onSessionEnd: () => {},
        onStats: context.events.onStats,
      }

      const subContext: ToolContext = {
        profile: subProfile,
        session: subSession,
        workingDir: subProfile.working_dir,
        memory: subMemory,
        skills: subSkills,
        mcpEntries: subMcpEntries,
        events: subEvents,
        openai: subOpenai,
        signal: context.signal,
        delegateDepth: (context.delegateDepth ?? 0) + 1,
        maxDepth,
        agentTools: [], // sub-agents don't inherit parent's agent registry
      }

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

      // 5–6. Output parsing + validation (shared util)
      const messages = subSession.messages as Array<{ role: string; content?: string | null }>
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
      const raw = lastAssistant?.content ?? ''
      const result = parseJsonContract(raw, outputValidator)
      if (!result.ok) {
        return `Error: agent "${agentName}" ${result.error}`
      }

      // 7. Return validated output as JSON string
      return JSON.stringify(result.value)
    } finally {
      await destroyMcpClients(subMcpEntries).catch(() => {})
    }
  } catch (e: any) {
    return `Error: agent "${agentName}" failed: ${e.message}`
  }
}
