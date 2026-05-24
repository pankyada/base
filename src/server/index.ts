import { WebSocketServer, WebSocket } from 'ws'
import { resolve } from 'path'
import { homedir } from 'os'
import { readFileSync } from 'fs'
import { loadProfile } from '../profiles/loader.js'
import { createSession, saveSession, loadSession } from '../session/store.js'
import { createProviderClient } from '../provider/client.js'
import { initMcpClients, closeMcpClients } from '../mcp/client.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { loadAllSkills } from '../skills/loader.js'
import { registerAll, clearRegistry } from '../tools/builtin/index.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { ClientMessage, ServerMessage } from '../types.js'

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')

async function main() {
  const profileArg = process.argv[2]
  const profilePath = profileArg
    ? resolve(profileArg)
    : resolve(homedir(), '.harness', 'profiles', 'coding.yaml')

  const profile = loadProfile(profilePath)

  clearRegistry()
  registerAll()
  await initMcpClients(profile)

  const openai = createProviderClient(profile)
  const skills = loadAllSkills(profile.skills_dirs)
  const skillIndex = buildSkillIndex(skills)
  const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')

  const wss = new WebSocketServer({ port: PORT })
  console.log(`Harness server on ws://localhost:${PORT} [profile: ${profile.name}]`)

  wss.on('connection', (ws: WebSocket) => {
    let session = createSession(profile.name)
    let memory = new FsMemoryProvider(profile.artifact_dir, session)
    let abortController = new AbortController()
    const pendingApprovals = new Map<string, (approved: boolean) => void>()

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
        const loaded = loadSession(msg.sessionId)
        if (loaded) {
          session = loaded
          memory = new FsMemoryProvider(profile.artifact_dir, session)
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

        const context = {
          profile, session, workingDir: profile.working_dir, memory, skills,
        }

        try {
          await runAgentLoop(msg.content, profile, session, context, {
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
              send({ type: 'stats', tokens_in, tokens_out, cost_usd })
            },
          }, openai, abortController.signal)
        } catch (e: any) {
          if (e.name !== 'AbortError') {
            send({ type: 'error', message: e.message })
          }
        }
      }
    })

    ws.on('close', () => { saveSession(session) })
    ws.on('error', (e) => console.error('ws error:', e.message))
  })

  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await closeMcpClients()
    wss.close()
    process.exit(0)
  })
}

main().catch(e => { console.error(e); process.exit(1) })
