import { WebSocketServer, WebSocket } from 'ws'
import { resolve } from 'path'
import { homedir, userInfo } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sanitizeUserId } from '../session/user-paths.js'
import { recordUsage } from '../usage/ledger.js'
import { DefaultImprover } from '../improver/default-improver.js'
import { runHooks } from '../hooks/runner.js'
import { loadProfile } from '../profiles/loader.js'
import { loadAgentTools } from '../agents/loader.js'
import { createSession, saveSession, loadSession } from '../session/store.js'
import { createProviderClient } from '../provider/client.js'
import { createMcpClients, destroyMcpClients, McpEntry } from '../mcp/client.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { MemoryProvider } from '../memory/interface.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { registerAll, clearRegistry, registerTool } from '../tools/builtin/index.js'
import { resolveToolsDirs, loadAllCustomTools } from '../tools/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'
import { ClientMessage, ServerMessage } from '../types.js'

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')

function readSessionCount(artifactDir: string): number {
  const path = `${artifactDir}/session-count.json`
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')).count ?? 0
  } catch { /* corrupt file — reset */ }
  return 0
}

function writeSessionCount(artifactDir: string, count: number): void {
  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(`${artifactDir}/session-count.json`, JSON.stringify({ count }), 'utf-8')
}

async function main() {
  const profileArg = process.argv[2]
  const profilePath = profileArg
    ? resolve(profileArg)
    : resolve(homedir(), '.harness', 'profiles', 'coding.yaml')

  const profile = loadProfile(profilePath)

  clearRegistry()
  registerAll()

  const customToolsDirs = resolveToolsDirs()
  const customTools = await loadAllCustomTools(customToolsDirs)
  for (const tool of customTools) {
    registerTool(tool)
  }

  const openai = createProviderClient(profile)
  const improver = new DefaultImprover(profile, openai)
  const skills = loadAllSkills(resolveSkillsDirs())
  const skillIndex = buildSkillIndex(skills)
  const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')

  const wss = new WebSocketServer({ port: PORT })
  console.log(`Harness server on ws://localhost:${PORT} [profile: ${profile.name}]`)

  const openSockets = new Set<WebSocket>()

  wss.on('connection', (ws: WebSocket) => {
    openSockets.add(ws)
    let userId = sanitizeUserId(process.env.HARNESS_USER ?? userInfo().username)
    let session = createSession(profile.name, userId)
    let memory: MemoryProvider = profile.memory?.provider === 'graph'
      ? new GraphMemoryProvider(profile.artifact_dir, session)
      : new FsMemoryProvider(profile.artifact_dir, session)
    let usageAtConnectionStart = { ...session.usage }
    let abortController = new AbortController()
    const pendingApprovals = new Map<string, (approved: boolean) => void>()
    let mcpEntries: McpEntry[] = []

    // Init MCP clients async — handlers below work with [] until ready
    createMcpClients(profile)
      .then(entries => { mcpEntries = entries })
      .catch(e => console.error('[mcp] init failed:', e.message))

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }

    ws.on('message', async (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        send({ type: 'error', message: 'Invalid JSON' })
        return
      }

      if (msg.type === 'hello') {
        // Only honour hello before the session has any messages
        if (session.messages.length === 0) {
          userId = sanitizeUserId(msg.user_id)
          session = createSession(profile.name, userId)
          memory = profile.memory?.provider === 'graph'
            ? new GraphMemoryProvider(profile.artifact_dir, session)
            : new FsMemoryProvider(profile.artifact_dir, session)
          usageAtConnectionStart = { ...session.usage }
        }
        return
      }

      if (msg.type === 'cancel') {
        abortController.abort()
        abortController = new AbortController()
        return
      }

      if (msg.type === 'tool_approve' || msg.type === 'tool_deny') {
        const cb = pendingApprovals.get(msg.id)
        if (cb) { pendingApprovals.delete(msg.id); cb(msg.type === 'tool_approve') }
        return
      }

      if (msg.type === 'resume') {
        const loaded = loadSession(userId, msg.sessionId)
        if (loaded) {
          session = loaded
          memory = profile.memory?.provider === 'graph'
            ? new GraphMemoryProvider(profile.artifact_dir, session)
            : new FsMemoryProvider(profile.artifact_dir, session)
          usageAtConnectionStart = { ...session.usage }
          send({ type: 'session_end', sessionId: session.id })
        } else {
          send({ type: 'error', message: `Session ${msg.sessionId} not found` })
        }
        return
      }

      if (msg.type === 'message') {
        // Build system prompt with memory on first turn
        if (session.messages.length === 0) {
          const memSection = await memory.buildSystemPromptSection()
          session.messages.push({
            role: 'system',
            content: systemPromptBase + skillIndex + memSection,
          })
        }

        const events: AgentLoopEvents = {
          onToken: t => send({ type: 'token', content: t }),
          onToolStart: (n, i) => send({ type: 'tool_start', name: n, input: i }),
          onToolEnd: (n, r) => send({ type: 'tool_end', name: n, result: r }),
          onToolPrompt: (id, n, i) => new Promise<boolean>(res => {
            pendingApprovals.set(id, res)
            send({ type: 'tool_prompt', id, name: n, input: i })
          }),
          onSessionEnd: (id) => {
            saveSession(session)
            send({ type: 'session_end', sessionId: id })
          },
          onStats: (tokens_in, tokens_out, cost_usd) => {
            send({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: profile.context_window?.max_tokens ?? 0 })
          },
        }
        const agentTools = await loadAgentTools(profile)
        const context: ToolContext = {
          profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
          events, openai, signal: abortController.signal, delegateDepth: 0,
          agentTools,
          maxDepth: profile.max_depth ?? 2,
        }

        try {
          await runAgentLoop(msg.content, profile, session, context, events, openai, abortController.signal)
        } catch (e: any) {
          if (e.name !== 'AbortError') {
            send({ type: 'error', message: e.message })
          }
        }
      }
    })

    ws.on('close', () => {
      openSockets.delete(ws)
      saveSession(session)
      const connectionDelta = {
        input: session.usage.input - usageAtConnectionStart.input,
        output: session.usage.output - usageAtConnectionStart.output,
        cost_usd: session.usage.cost_usd - usageAtConnectionStart.cost_usd,
      }
      recordUsage(session.user, connectionDelta)

      // Destroy per-connection MCP clients (fire-and-forget)
      void destroyMcpClients(mcpEntries).catch(e => console.error('[mcp] destroy error:', e.message))

      // on_stop hooks (fire-and-forget — close handler cannot be async)
      void runHooks('on_stop', profile, { SESSION_ID: session.id, PROFILE: profile.name })
        .catch(e => console.error('[on_stop hook] error:', e.message))

      // self-improvement (fire-and-forget)
      const userTurns = (session.messages as any[]).filter(m => m.role === 'user').length
      if (userTurns >= 2 && profile.improvement?.enabled) {
        void improver.reflect(session, memory).catch(e =>
          console.error('[improver] reflect failed:', e.message)
        )

        const mineEvery = profile.improvement?.mine_skills_every_n_sessions ?? 10
        let count = readSessionCount(profile.artifact_dir) + 1
        if (count >= mineEvery) {
          count = 0
          void improver.mineSkills([session]).catch(e =>
            console.error('[improver] mineSkills failed:', e.message)
          )
        }
        writeSessionCount(profile.artifact_dir, count)
      }
    })
    ws.on('error', (e) => console.error('ws error:', e.message))
  })

  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    for (const ws of openSockets) ws.terminate()  // triggers 'close' event → destroyMcpClients fires
    wss.close()
    process.exit(0)
  })
}

main().catch(e => { console.error(e); process.exit(1) })
