import { createServer } from 'http'
import { randomUUID } from 'crypto'
import { createRestHandler } from './rest.js'
import { WebSocketServer, WebSocket } from 'ws'
import { resolve } from 'path'
import { homedir, userInfo } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sanitizeUserId } from '../session/user-paths.js'
import { recordUsage } from '../usage/ledger.js'
import { RunStore } from '../runs/store.js'
import { PendingStore } from '../runs/pending.js'
import { CronScheduler } from '../scheduler/cron.js'
import { runProfileOnce } from './run-profile.js'
import { DefaultImprover } from '../improver/default-improver.js'
import { runHooks } from '../hooks/runner.js'
import { loadProfile, applyModeDefaults } from '../profiles/loader.js'
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
import { listProposed, listInstalled, readSkill, writeSkill, promoteSkill, discardSkill } from '../skills/manage.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { runWorkflow } from '../workflow/runner.js'
import { sweepDeferredLabels } from '../workflow/labeler.js'
import { listModels } from '../models/registry.js'
import { project } from '../context/projection.js'
import { contextWindowFor, estimateTokens } from '../context/estimator.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'
import { ClientMessage, ServerMessage } from '../types.js'
import { handleProjectMessage } from './project-handlers.js'
import { ChannelRuntime } from '../channels/runtime.js'
import { isParkSignal } from '../runs/park.js'
import { resumeExpiredInput, resumePendingInput } from '../runs/resume.js'
import pkg from '../../package.json' with { type: 'json' }

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`harness-server ${pkg.version}`)
  process.exit(0)
}

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')

function randomRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

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
  const channels = new ChannelRuntime(profile)
  const runStore = new RunStore()
  const pendingStore = new PendingStore()
  const abortRegistry = new Map<string, AbortController>()
  channels.onInbound(async route => {
    if (route.binding.profile !== profile.name) return
    if (route.message.correlation_id) {
      const pending = pendingStore.get(route.message.correlation_id)
      if (pending && pending.user === route.binding.user) {
        const answer = route.message.button_id ?? route.message.text
        const result = await resumePendingInput(route.message.correlation_id, answer, 'channel', {
          pendingStore, runStore, abortRegistry,
          resolveProfile: name => name === profile.name ? profile : null,
          channels,
        })
        if (result.status === 'completed' && result.finalText) {
          await channels.send(route.binding.user, route.channel, { text: result.finalText })
        }
        return
      }
    }
    const runId = randomRunId()
    const abort = new AbortController()
    abortRegistry.set(runId, abort)
    runStore.create({
      id: runId, profile: profile.name, user: route.binding.user, trigger: 'webhook',
      input: route.message.text, status: 'running', started_at: new Date().toISOString(),
    })
    const events: AgentLoopEvents = {
      onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
      onToolPrompt: (id, name, input, risk, reason) => channels.requestApproval(route.binding.user, name, input, risk, reason),
      onInputRequest: (_id, prompt, kind, options) => channels.requestInput(route.binding.user, prompt, kind, options).then(value => value ?? ''),
      onSessionEnd: () => {}, onStats: () => {},
    }
    try {
      const result = await runProfileOnce({ profile, userId: route.binding.user, userMessage: route.message.text, events, channels, runId, pendingInputs: pendingStore, signal: abort.signal, unattended: true })
      abortRegistry.delete(runId)
      runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
      if (result.finalText) await channels.send(route.binding.user, route.channel, { text: result.finalText })
    } catch (error: any) {
      abortRegistry.delete(runId)
      if (isParkSignal(error)) {
        runStore.update(runId, { status: 'waiting_input', session_id: error.sessionId })
        return
      }
      runStore.update(runId, { status: 'failed', error: error.message, finished_at: new Date().toISOString() })
      await channels.send(route.binding.user, route.channel, { text: `run failed: ${error.message}`, urgency: 'high' })
    }
  })
  await channels.init()
  const sweepPending = async () => {
    for (const expired of pendingStore.sweep()) {
      await resumeExpiredInput(expired.id, {
        pendingStore, runStore, abortRegistry,
        resolveProfile: name => name === profile.name ? profile : null,
        channels,
      })
    }
  }
  void sweepPending()
  const pendingSweepTimer = setInterval(() => { void sweepPending() }, 60_000)
  pendingSweepTimer.unref()
  // One-time sweep of the legacy profile-scoped label bucket (pre-dates
  // per-user/per-project scoping below). Per-session sweeps below are what
  // actually keep deferred labels current across a long-running server.
  void sweepDeferredLabels(profile).catch(() => {})

  // Crash recovery: re-queue any runs left in 'running' state from a prior crash
  const stalledRuns = runStore.scanRunning()
  const stalledFailed = new Map<string, number>() // profile → count
  const stalledRequeued: string[] = []
  for (const run of stalledRuns) {
    const candidates = [
      resolve(process.cwd(), 'profiles', `${run.profile}.yaml`),
      resolve(homedir(), '.harness', 'profiles', `${run.profile}.yaml`),
    ]
    const runProfilePath = candidates.find(p => existsSync(p))
    if (!runProfilePath) {
      runStore.update(run.id, { status: 'failed', error: 'profile not found on restart', finished_at: new Date().toISOString() })
      stalledFailed.set(run.profile, (stalledFailed.get(run.profile) ?? 0) + 1)
      continue
    }
    const stalledProfile = loadProfile(runProfilePath)
    void runProfileOnce({
      profile: stalledProfile, userId: run.user,
      userMessage: typeof run.input === 'string' ? run.input : JSON.stringify(run.input),
      events: { onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {} },
      channels,
      pendingInputs: pendingStore,
      unattended: true,
    })
      .then(r => runStore.update(run.id, { status: 'completed', session_id: r.session.id, finished_at: new Date().toISOString() }))
      .catch(e => runStore.update(run.id, { status: 'failed', error: e.message, finished_at: new Date().toISOString() }))
    stalledRequeued.push(run.id)
  }
  for (const [profile, count] of stalledFailed) {
    console.warn(`[runs] ${count} stalled run(s) failed: profile '${profile}' not found`)
  }
  if (stalledRequeued.length) {
    console.log(`[runs] re-queued ${stalledRequeued.length} stalled run(s)`)
  }

  clearRegistry()
  registerAll(channels)

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

  const apiKey = process.env.HARNESS_API_KEY?.trim() || undefined
  if (process.env.HARNESS_API_KEY !== undefined && !apiKey) {
    console.warn('[auth] HARNESS_API_KEY is set but empty — ignoring, server is unauthenticated')
  }

  const scheduler = new CronScheduler(profile, runStore, abortRegistry, channels, pendingStore)
  scheduler.init()
  if (profile.triggers?.cron) {
    console.log(`[cron] registered schedule '${profile.triggers.cron}' for profile '${profile.name}'`)
  }

  const restHandler = createRestHandler({ defaultProfile: profile, apiKey, runStore, abortRegistry, skills, channels, pendingStore })
  const httpServer = createServer((req, res) => { void restHandler(req, res) })
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, cb) => {
      if (!apiKey) {
        cb(true)  // no key set → open dev mode
        return
      }
      const auth = info.req.headers['authorization']
      if (auth === `Bearer ${apiKey}`) {
        cb(true)
      } else {
        cb(false, 401, 'Unauthorized')
      }
    },
  })
  httpServer.listen(PORT, () => {
    console.log(`Harness server on ws://localhost:${PORT} [profile: ${profile.name}]`)
    console.log(`REST endpoints: http://localhost:${PORT} (/run, /stream, /health)`)
    if (!apiKey) {
      console.warn('[rest] HARNESS_API_KEY not set — REST endpoints are UNAUTHENTICATED')
    }
  })

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
    const pendingInputRequests = new Map<string, (value: string) => void>()
    const pendingCodeExecutions = new Map<string, (result: any) => void>()
    let mcpEntries: McpEntry[] = []
    let wasmSupported = false
    let connectionProfile = profile  // may be overridden to developer mode via yolo
    let approvalMode: 'strict' | 'bash' | 'danger' | 'yolo' = 'danger'
    let connectionModel = profile.model.id
    let miningSkills = false
    let safetyDisclosed = false

    const rebuildConnectionProfile = () => {
      connectionProfile = { ...profile, model: { ...profile.model, id: connectionModel } }
    }

    // Init MCP clients async — handlers below work with [] until ready
    createMcpClients(profile)
      .then(entries => { mcpEntries = entries })
      .catch(e => console.error('[mcp] init failed:', e.message))

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }

    const sendSkills = () => send({ type: 'skills', proposed: listProposed(connectionProfile), installed: listInstalled() })
    const sendPending = () => send({
      type: 'pending',
      pending: pendingStore.list({ user: userId, state: 'open' }).map(({ path: _path, ...record }) => record),
    })

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
          wasmSupported = msg.wasm_supported ?? false
          // YOLO mode: apply developer ACL preset (all tools = allow) for this connection
          connectionProfile = msg.yolo
            ? applyModeDefaults({ ...profile, mode: 'developer' })
            : profile
          approvalMode = msg.yolo ? 'yolo' : 'danger'
          connectionModel = connectionProfile.model.id
          session = createSession(connectionProfile.name, userId)
          memory = connectionProfile.memory?.provider === 'graph'
            ? new GraphMemoryProvider(connectionProfile.artifact_dir, session)
            : new FsMemoryProvider(connectionProfile.artifact_dir, session)
          usageAtConnectionStart = { ...session.usage }
          // Runs per hello, not just once at process boot — the server is
          // long-running and stays up across many sessions, so this is what
          // actually keeps deferred (human-edit-churn) labels current.
          void sweepDeferredLabels(session.user, session.project).catch(() => {})
        }
        send({ type: 'session_ready', sessionId: session.id, profile: connectionProfile.name, model: connectionProfile.model.id, working_dir: connectionProfile.working_dir, yolo: msg.yolo ?? false })
        send({ type: 'approval_mode_changed', mode: approvalMode })
        sendPending()
        return
      }

      if (msg.type === 'pending_list') {
        sendPending()
        return
      }

      if (msg.type === 'pending_answer') {
        const result = await resumePendingInput(msg.pending_id, msg.value, 'ws', {
          pendingStore, runStore, abortRegistry,
          resolveProfile: name => name === connectionProfile.name ? connectionProfile : null,
          channels,
          events: {
            onToken: t => send({ type: 'token', content: t }),
            onToolStart: (n, i) => send({ type: 'tool_start', name: n, input: i }),
            onToolEnd: (n, r) => send({ type: 'tool_end', name: n, result: r }),
            onToolPrompt: (id, n, i, risk, reason) => new Promise<boolean>(resolve => {
              pendingApprovals.set(id, resolve)
              send({ type: 'tool_prompt', id, name: n, input: i, risk, reason })
            }),
            onSessionEnd: id => send({ type: 'session_end', sessionId: id }),
            onStats: (tokens_in, tokens_out, cost_usd, context_tokens) => send({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens }),
            onInputRequest: (id, prompt, kind, options) => new Promise<string>(resolve => {
              pendingInputRequests.set(id, resolve)
              send({ type: 'input_request', id, prompt, kind, options })
            }),
          },
        })
        if (result.status === 'failed' || result.status === 'ignored') {
          send({ type: 'error', message: result.status === 'failed' ? result.error : result.reason })
        }
        sendPending()
        return
      }

      if (msg.type === 'set_approval_mode') {
        if (msg.mode !== 'strict' && msg.mode !== 'bash' && msg.mode !== 'danger' && msg.mode !== 'yolo') {
          send({ type: 'notice', level: 'error', message: 'unknown approval mode', detail: 'use strict, bash, danger, or yolo' })
          return
        }
        approvalMode = msg.mode
        send({ type: 'approval_mode_changed', mode: approvalMode })
        return
      }

      if (msg.type === 'models_list') {
        const activeProfile = { ...profile, model: { ...profile.model, id: connectionModel } }
        send({ type: 'models', models: listModels(activeProfile), current: connectionModel })
        return
      }

      if (msg.type === 'set_model') {
        const candidate = listModels(profile).find(model => model.id === msg.model)
        if (candidate && !candidate.available) {
          send({ type: 'notice', level: 'error', message: `model ${msg.model} requires another provider`, detail: candidate.reason })
          return
        }
        if (!candidate) {
          send({ type: 'notice', level: 'warn', message: `unknown model ${msg.model}`, detail: 'fallback pricing applies' })
        }
        connectionModel = msg.model
        rebuildConnectionProfile()
        send({ type: 'model_changed', model: connectionModel })
        return
      }

      if (msg.type === 'skills_list') {
        sendSkills()
        return
      }

      if (msg.type === 'skill_get') {
        try {
          const skill = readSkill(msg.name, msg.source, connectionProfile)
          send({ type: 'skill_content', ...skill })
        } catch (error: any) {
          send({ type: 'notice', level: 'error', message: 'skill read failed', detail: error.message })
        }
        return
      }

      if (msg.type === 'skill_save') {
        try {
          const result = writeSkill(msg.name, msg.content, connectionProfile)
          send({ type: 'skill_result', action: 'saved', name: msg.name, path: result.path })
        } catch (error: any) {
          send({ type: 'notice', level: 'error', message: 'skill save failed', detail: error.message })
        }
        return
      }

      if (msg.type === 'skill_promote') {
        try {
          const result = promoteSkill(msg.name, connectionProfile)
          send({ type: 'skill_result', action: 'promoted', name: msg.name, path: result.path })
        } catch (error: any) {
          send({ type: 'notice', level: 'error', message: 'skill promote failed', detail: error.message })
        }
        return
      }

      if (msg.type === 'skill_discard') {
        try {
          const result = discardSkill(msg.name, connectionProfile)
          send({ type: 'skill_result', action: 'discarded', name: msg.name, path: result.path })
        } catch (error: any) {
          send({ type: 'notice', level: 'error', message: 'skill discard failed', detail: error.message })
        }
        return
      }

      if (msg.type === 'skills_mine') {
        if (miningSkills) {
          send({ type: 'notice', level: 'info', message: 'skills mining already running' })
          return
        }
        const userTurns = (session.messages as any[]).filter(item => item.role === 'user').length
        if (!connectionProfile.improvement?.enabled) {
          send({ type: 'notice', level: 'warn', message: 'skills mining disabled', detail: 'set improvement.enabled: true' })
          return
        }
        if (userTurns < 2) {
          send({ type: 'notice', level: 'warn', message: 'need two user turns before mining' })
          return
        }
        miningSkills = true
        send({ type: 'notice', level: 'info', message: 'mining skills…' })
        try {
          await improver.mineSkills([session])
          sendSkills()
        } catch (error: any) {
          send({ type: 'notice', level: 'error', message: 'skills mining failed', detail: error.message })
        } finally {
          miningSkills = false
        }
        return
      }

      if (msg.type === 'compact') {
        const before = estimateTokens(await project(session, connectionProfile, openai, memory))
        const compactProfile = {
          ...connectionProfile,
          context: {
            max_tokens: connectionProfile.context?.max_tokens ?? contextWindowFor(connectionProfile),
            high_water: 0,
            low_water: 0,
            tail_turns: connectionProfile.context?.tail_turns ?? 0,
            pin_budget: connectionProfile.context?.pin_budget ?? 0.25,
            digest_model_id: connectionProfile.context?.digest_model_id,
            cache: connectionProfile.context?.cache ?? false,
          },
        }
        const afterProjection = await project(session, compactProfile, openai, memory)
        const after = estimateTokens(afterProjection, session)
        saveSession(session)
        send({ type: 'stats', tokens_in: session.usage.input, tokens_out: session.usage.output, cost_usd: session.usage.cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens: after })
        send({ type: 'notice', level: 'info', message: before > after ? `compacted context · ${before - after} tokens saved` : 'context already compact', detail: before > after ? `${before} → ${after} tokens` : 'no condensation needed' })
        return
      }

      if (msg.type === 'cancel') {
        abortController.abort()
        abortController = new AbortController()
		for (const resolve of pendingApprovals.values()) resolve(false)
		pendingApprovals.clear()
		for (const resolve of pendingInputRequests.values()) resolve('')
		pendingInputRequests.clear()
        return
      }

      if (msg.type === 'tool_approve' || msg.type === 'tool_deny') {
        const cb = pendingApprovals.get(msg.id)
        if (cb) { pendingApprovals.delete(msg.id); cb(msg.type === 'tool_approve') }
        return
      }

      if (msg.type === 'input_response') {
        const cb = pendingInputRequests.get(msg.id)
        if (cb) { pendingInputRequests.delete(msg.id); cb(msg.value) }
        return
      }

      if (msg.type === 'code_result') {
        const cb = pendingCodeExecutions.get(msg.id)
        if (cb) {
          pendingCodeExecutions.delete(msg.id)
          cb({ id: msg.id, stdout: msg.stdout, stderr: msg.stderr, exit_code: msg.exit_code, files: msg.files, duration_ms: 0 })
        }
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
          send({ type: 'session_resumed', sessionId: session.id })
        } else {
          send({ type: 'error', message: `Session ${msg.sessionId} not found` })
        }
        return
      }

      const projectReply = handleProjectMessage(msg, userId)
      if (projectReply) { send(projectReply); return }

      if (msg.type === 'message') {
        const runId = randomRunId()
        runStore.create({
          id: runId, profile: connectionProfile.name, user: userId, trigger: 'stream',
          input: msg.content, status: 'running', started_at: new Date().toISOString(),
        })
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
          onToolPrompt: (id, n, i, risk, reason) => new Promise<boolean>(res => {
            pendingApprovals.set(id, res)
            send({ type: 'tool_prompt', id, name: n, input: i, risk, reason })
          }),
          onSessionEnd: (id) => {
            saveSession(session)
            send({ type: 'session_end', sessionId: id })
          },
          onStats: (tokens_in, tokens_out, cost_usd, context_tokens) => {
            send({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens })
          },
          onSafetyNotice: (classifierModel) => {
            if (safetyDisclosed) return
            safetyDisclosed = true
            send({ type: 'notice', level: 'info', message: `ambiguous tools classified by ${classifierModel}`, detail: 'verdicts are cached · set safety.enabled: false or use /approval bash to opt out' })
          },
          onNotice: (level, message, detail) => send({ type: 'notice', level, message, detail }),
          onArtifacts: (sessionId, artifacts) => {
            send({ type: 'artifacts', sessionId, artifacts })
          },
          onInputRequest: (id, prompt, kind, options) => new Promise<string>(res => {
            pendingInputRequests.set(id, res)
            send({ type: 'input_request', id, prompt, kind, options })
          }),
          onTodosUpdate: (todos) => {
            send({ type: 'todos', todos })
          },
          onCodeExecute: (id, code, language, data) => new Promise(resolve => {
            pendingCodeExecutions.set(id, resolve)
            send({ type: 'code_execute', id, code, language, data })
          }),
          onStage: (stage, intensity, tier, model, state, cost_usd) => send({ type: 'stage', stage, intensity, tier, model, state, cost_usd }),
        }
        const agentTools = await loadAgentTools(connectionProfile)
        const context: ToolContext = {
          profile: connectionProfile, session, workingDir: connectionProfile.working_dir, memory, skills, mcpEntries,
          events, openai, signal: abortController.signal, delegateDepth: 0,
          agentTools,
          maxDepth: connectionProfile.max_depth ?? 2,
          wasmSupported,
          approvalMode,
          channels,
          runId,
          pendingInputs: pendingStore,
        }

        const runSignal = abortController.signal
        try {
          if (connectionProfile.workflow?.enabled) {
            await runWorkflow(msg.content, connectionProfile, session, context, events, openai, runSignal)
          } else {
            await runAgentLoop(msg.content, connectionProfile, session, context, events, openai, runSignal)
          }
          runStore.update(runId, { status: 'completed', session_id: session.id, finished_at: new Date().toISOString() })
          if (runSignal.aborted) {
            saveSession(session)
            send({ type: 'session_end', sessionId: session.id })
          }
        } catch (e: any) {
          if (isParkSignal(e)) {
            runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
            sendPending()
            return
          }
          runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
          if (e.name !== 'AbortError') {
            send({ type: 'error', message: e.message })
          }
		  if (runSignal.aborted) {
		    saveSession(session)
		    send({ type: 'session_end', sessionId: session.id })
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
    scheduler.stop()
    for (const ws of openSockets) ws.terminate()  // triggers 'close' event → destroyMcpClients fires
    wss.close()
    httpServer.close()
    void channels.stop()
    process.exit(0)
  })
}

main().catch(e => { console.error(e); process.exit(1) })
