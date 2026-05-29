import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { ToolDefinition, ToolContext, AgentLoopEvents } from '../types.js'
import { loadProfile } from '../../profiles/loader.js'
import { createProviderClient } from '../../provider/client.js'
import { createMcpClients, destroyMcpClients } from '../../mcp/client.js'
import { createSession } from '../../session/store.js'
import { FsMemoryProvider } from '../../memory/fs-memory.js'
import { GraphMemoryProvider } from '../../memory/graph-memory.js'
import { MemoryProvider } from '../../memory/interface.js'
import { loadAllSkills, resolveSkillsDirs } from '../../skills/loader.js'
import { buildSkillIndex } from '../../skills/indexer.js'
import { runAgentLoop } from '../../loop/agent-loop.js'

function findProfilePath(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'profiles', `${name}.yaml`),
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

    // Depth limit — sub-agents cannot delegate further
    if ((context.delegateDepth ?? 0) >= 1) {
      return 'Error: cannot delegate from within a sub-agent (max depth is 1).'
    }

    // Profile discovery
    const profilePath = findProfilePath(profileName)
    if (!profilePath) {
      return (
        `Error: profile "${profileName}" not found. ` +
        `Searched: profiles/${profileName}.yaml, ~/.harness/profiles/${profileName}.yaml`
      )
    }

    try {
      const subProfile = loadProfile(profilePath)
      const subOpenai = createProviderClient(subProfile)
      const subMcpEntries = await createMcpClients(subProfile)

      try {
        const subSession = createSession(subProfile.name, context.session.user)
        const subMemory: MemoryProvider = subProfile.memory?.provider === 'graph'
          ? new GraphMemoryProvider(subProfile.artifact_dir, subSession)
          : new FsMemoryProvider(subProfile.artifact_dir, subSession)
        const subSkills = loadAllSkills(resolveSkillsDirs())

        // Build system prompt for sub-agent
        const systemPromptBase = readFileSync(subProfile.system_prompt, 'utf-8')
        const skillIndex = buildSkillIndex(subSkills)
        const memSection = await subMemory.buildSystemPromptSection()
        subSession.messages.push({
          role: 'system',
          content: systemPromptBase + skillIndex + memSection,
        })

        // Forward all sub-agent events to parent WebSocket
        const subEvents: AgentLoopEvents = {
          onToken: t => context.events.onToken(t),
          onToolStart: (n, i) => context.events.onToolStart(n, i),
          onToolEnd: (n, r) => context.events.onToolEnd(n, r),
          onToolPrompt: (id, n, i) => context.events.onToolPrompt(id, n, i),
          onSessionEnd: () => { /* no-op — parent manages its own session end */ },
          onStats: (a, b, c) => context.events.onStats?.(a, b, c),
        }

        // Sub-context: delegateDepth = 1 blocks further delegation
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
          delegateDepth: 1,
        }

        await runAgentLoop(task, subProfile, subSession, subContext, subEvents, subOpenai, context.signal)

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

        return `[Delegate: ${profileName}]\n${finalText}\n\n${toolSummary}`
      } finally {
        await destroyMcpClients(subMcpEntries).catch(() => {})
      }
    } catch (e: any) {
      return `Error: delegate to "${profileName}" failed: ${e.message}`
    }
  },
}
