import { readFileSync } from 'fs'
import { createProviderClient } from '../provider/client.js'
import { createMcpClients, destroyMcpClients } from '../mcp/client.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { loadAgentTools } from '../agents/loader.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { recordUsage } from '../usage/ledger.js'
import { sanitizeUserId } from '../session/user-paths.js'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'

export interface RestUsage { tokens_in: number; tokens_out: number; cost_usd: number }

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
}

/** One-shot root run of a profile: build context, run the loop, extract final text + usage. */
export async function runProfileOnce(opts: RunProfileOptions): Promise<RunProfileResult> {
  const { profile, userMessage, events, signal } = opts
  const user = sanitizeUserId(opts.userId)
  const openai = createProviderClient(profile)
  const mcpEntries = await createMcpClients(profile)

  try {
    const session = createSession(profile.name, user)
    const memory = profile.memory?.provider === 'graph'
      ? new GraphMemoryProvider(profile.artifact_dir, session)
      : new FsMemoryProvider(profile.artifact_dir, session)
    const skills = loadAllSkills(resolveSkillsDirs())
    const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')
    const skillIndex = buildSkillIndex(skills)
    const memSection = await memory.buildSystemPromptSection()
    session.messages.push({ role: 'system', content: systemPromptBase + skillIndex + memSection })

    const agentTools = await loadAgentTools(profile)
    const context: ToolContext = {
      profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
      events, openai, signal, delegateDepth: 0, agentTools, maxDepth: profile.max_depth ?? 2,
    }

    await runAgentLoop(userMessage, profile, session, context, events, openai, signal)

    const messages = session.messages as Array<{ role: string; content?: string | null }>
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
    const finalText = lastAssistant?.content ?? ''

    const delta = { input: session.usage.input, output: session.usage.output, cost_usd: session.usage.cost_usd }
    recordUsage(user, delta)

    return {
      finalText,
      usage: { tokens_in: delta.input, tokens_out: delta.output, cost_usd: delta.cost_usd },
      session,
    }
  } finally {
    await destroyMcpClients(mcpEntries).catch(() => {})
  }
}
