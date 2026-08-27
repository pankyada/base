import { createServer } from 'http'
import { randomUUID } from 'crypto'
import { createRestHandler } from './rest.js'
import { checkOrigin, loadOriginPolicy } from './origin.js'
import { WebSocketServer, WebSocket } from 'ws'
import { resolve } from 'path'
import { homedir, userInfo } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sanitizeUserId } from '../session/user-paths.js'
import { recordUsage } from '../usage/ledger.js'
import { RunStore } from '../runs/store.js'
import { PendingStore } from '../runs/pending.js'
import { TriggerManager } from '../triggers/manager.js'
import { runProfileOnce } from './run-profile.js'
import { DefaultImprover } from '../improver/default-improver.js'
import { runHooks } from '../hooks/runner.js'
import { loadProfile } from '../profiles/loader.js'
import { loadStartupProfiles } from './profile-startup.js'
import { readUserConfig } from '../config/user-config.js'
import { loadUserEnv } from '../config/user-env.js'
import { loadAgentTools } from '../agents/loader.js'
import { buildAgentCatalog } from '../agents/catalog.js'
import { runBoundedPool } from '../agents/pool.js'
import { createSession, saveSession, loadSession } from '../session/store.js'
import { createProviderClient } from '../provider/client.js'
import { createMcpClients, destroyMcpClients, McpEntry } from '../mcp/client.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { MemoryProvider } from '../memory/interface.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { commandSummaries, loadAllCommands, resolveCommandDirs } from '../skills/commands.js'
import { registerAll, clearRegistry, registerTool } from '../tools/builtin/index.js'
import { resolveToolsDirs, loadAllCustomTools } from '../tools/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { buildInteractiveSystemPrompt } from './interactive-prompt.js'
import { listProposed, listInstalled, readSkill, writeSkill, promoteSkill, discardSkill } from '../skills/manage.js'
import { runPlanPreview } from '../workflow/runner.js'
import { runApprovedPlanFollowOn, runInteractiveTurn } from './turn-runner.js'
import { writeArtifact } from '../workflow/artifacts.js'
import { sweepDeferredLabels } from '../workflow/labeler.js'
import { listModels } from '../models/registry.js'
import { project } from '../context/projection.js'
import { contextWindowFor, estimateTokens } from '../context/estimator.js'
import type { AgentLoopEvents, ToolContext, ToolDefinition } from '../tools/types.js'
import { ClientMessage, ServerMessage, PROTOCOL_VERSION, type InputRequestKind } from '../types.js'
import { handleProjectMessage } from './project-handlers.js'
import { listUndoEntries, undoNotice } from './undo-handlers.js'
import { ChannelRuntime } from '../channels/runtime.js'
import { isParkSignal } from '../runs/park.js'
import { resumeExpiredInput, resumePendingInput } from '../runs/resume.js'
import { loadVoiceProviders } from '../voice/loader.js'
import { registerVoiceProvider, resolveVoiceProvider } from '../voice/registry.js'
import { registerServer, serverRecordFor, unregisterServer } from './process-registry.js'
import { VoiceInput } from '../voice/input.js'
import { VoiceTurn } from '../voice/session.js'
import { VoiceOutput } from '../voice/output.js'
import { isYoloEnabled, resolveApprovalLimit, resolveRequestedApprovalMode } from './approval-mode.js'
import { SessionApprovalGrants } from './session-approvals.js'
import { RunBudget, BudgetExceeded } from '../runs/budget.js'
import { sessionEndFromError, type SessionEndStatus } from './session-status.js'
import { createRootFrame } from '../agents/frames.js'
import { delegateTool } from '../tools/builtin/delegate.js'
import pkg from '../../package.json' with { type: 'json' }

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`harness-server ${pkg.version}`)
  process.exit(0)
}

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')

function randomRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function makeRunEmitter(runId: string, send: (message: ServerMessage) => void): (message: { type: ServerMessage['type'] } & Record<string, unknown>) => void {
  return message => send({ ...message, run_id: runId } as ServerMessage)
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
  loadUserEnv()
  const profileFlag = process.argv.indexOf('--profile')
  const profilesFlag = process.argv.indexOf('--profiles')
  const defaultFlag = process.argv.indexOf('--default-profile')
  const configuredPath = profilesFlag >= 0
    ? process.argv[profilesFlag + 1]
    : profileFlag >= 0
      ? process.argv[profileFlag + 1]
      : process.argv[2]
  const explicitDefaultName = defaultFlag >= 0 ? process.argv[defaultFlag + 1] : undefined
  const loadedProfiles = loadStartupProfiles({ configuredPath, explicitDefaultProfile: explicitDefaultName })
  const profiles = loadedProfiles.profiles
  const profile = loadedProfiles.defaultProfile
  for (const failed of loadedProfiles.errors) console.warn(`[profiles] skipped ${failed.path}: ${failed.error}`)
  if (profiles.size > 1 && !explicitDefaultName && !process.env.HARNESS_PROFILE && !readUserConfig()?.default_profile) console.warn(`[profiles] no --default-profile supplied; using ${profile.name}`)
  const channelsByProfile = new Map([...profiles.values()].map(item => [item.name, new ChannelRuntime(item)]))
  const channels = channelsByProfile.get(profile.name)!
  const originPolicy = loadOriginPolicy()
  const runStore = new RunStore()
  const pendingStore = new PendingStore()
  const abortRegistry = new Map<string, AbortController>()
  const wireInbound = (runtime: ChannelRuntime) => runtime.onInbound(async route => {
    const routeProfile = profiles.get(route.binding.profile)
    if (!routeProfile) return
    if (route.message.correlation_id) {
      const pending = pendingStore.get(route.message.correlation_id)
      if (pending && pending.user === route.binding.user) {
        const answer = route.message.button_id ?? route.message.text
        const result = await resumePendingInput(route.message.correlation_id, answer, 'channel', {
          pendingStore, runStore, abortRegistry,
          resolveProfile: name => profiles.get(name) ?? null,
          channels: runtime,
        })
        if (result.status === 'completed' && result.finalText) {
          await runtime.send(route.binding.user, route.channel, { text: result.finalText })
        }
        return
      }
    }
    const runId = randomRunId()
    const abort = new AbortController()
    abortRegistry.set(runId, abort)
    runStore.create({
      id: runId, profile: routeProfile.name, user: route.binding.user, trigger: 'webhook',
      input: route.message.text, status: 'running', started_at: new Date().toISOString(),
    })
    const events: AgentLoopEvents = {
      onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
      onToolPrompt: (id, name, input, risk, reason) => runtime.requestApproval(route.binding.user, name, input, risk, reason),
      onInputRequest: (_id, prompt, kind, options) => runtime.requestInput(route.binding.user, prompt, kind, options).then(value => value ?? ''),
      onSessionEnd: () => {}, onStats: () => {},
    }
    try {
      const result = await runProfileOnce({ profile: routeProfile, userId: route.binding.user, userMessage: route.message.text, events, channels: runtime, runId, pendingInputs: pendingStore, signal: abort.signal, unattended: true, initialTaintSources: route.trusted ? undefined : [`unpaired channel: ${route.channel}`] })
      abortRegistry.delete(runId)
      runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
      if (result.finalText) await runtime.send(route.binding.user, route.channel, { text: result.finalText })
    } catch (error: any) {
      abortRegistry.delete(runId)
      if (isParkSignal(error)) {
        runStore.update(runId, { status: 'waiting_input', session_id: error.sessionId })
        return
      }
      runStore.update(runId, { status: 'failed', error: error.message, finished_at: new Date().toISOString() })
      await runtime.send(route.binding.user, route.channel, { text: `run failed: ${error.message}`, urgency: 'high' })
    }
  })
  for (const runtime of channelsByProfile.values()) wireInbound(runtime)
  await Promise.all([...channelsByProfile.values()].map(runtime => runtime.init()))
  const sweepPending = async () => {
    for (const expired of pendingStore.sweep()) {
      await resumeExpiredInput(expired.id, {
        pendingStore, runStore, abortRegistry,
        resolveProfile: name => profiles.get(name) ?? null,
        channels: channelsByProfile.get(expired.profile),
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
    const registeredProfile = profiles.get(run.profile)
    const candidates = [resolve(homedir(), '.harness', 'profiles', `${run.profile}.yaml`)]
    const runProfilePath = registeredProfile ? undefined : candidates.find(p => existsSync(p))
    if (!registeredProfile && !runProfilePath) {
      runStore.update(run.id, { status: 'failed', error: 'profile not found on restart', finished_at: new Date().toISOString() })
      stalledFailed.set(run.profile, (stalledFailed.get(run.profile) ?? 0) + 1)
      continue
    }
    const stalledProfile = registeredProfile ?? loadProfile(runProfilePath!)
    void runProfileOnce({
      profile: stalledProfile, userId: run.user,
      userMessage: typeof run.input === 'string' ? run.input : JSON.stringify(run.input),
      events: { onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {} },
      channels: channelsByProfile.get(stalledProfile.name),
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
  // Built-ins are process-wide; Notify gets its per-profile runtime through
  // ToolContext, so register it whenever any loaded profile has channels.
  registerAll(
    [...channelsByProfile.values()].some(runtime => runtime.enabled) ? { enabled: true } as ChannelRuntime : undefined,
    profile,
  )

  const customToolsDirs = resolveToolsDirs()
  const customTools = await loadAllCustomTools(customToolsDirs)
  for (const tool of customTools) {
    registerTool(tool)
  }
  for (const provider of await loadVoiceProviders()) registerVoiceProvider(provider)

  const openai = createProviderClient(profile)
  const improver = new DefaultImprover(profile, openai)
  const skills = loadAllSkills(resolveSkillsDirs())
  const skillIndex = buildSkillIndex(skills)
  const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')

  const apiKey = process.env.HARNESS_API_KEY?.trim() || undefined
  if (process.env.HARNESS_API_KEY !== undefined && !apiKey) {
    console.warn('[auth] HARNESS_API_KEY is set but empty — ignoring, server is unauthenticated')
  }

  const schedulers = [...profiles.values()].map(owner => new TriggerManager({
    profile: owner, runStore, abortRegistry, channels: channelsByProfile.get(owner.name), pendingStore,
    probe: async (tool, args) => {
      const [serverName, toolName] = tool.split('__', 2)
      const entries = await createMcpClients(owner)
      try {
        const entry = entries.find(candidate => candidate.serverName === serverName && candidate.tools.some(candidateTool => candidateTool.name === toolName))
        if (!entry || !toolName) throw new Error(`poll probe tool "${tool}" is unavailable`)
        const result = await entry.client.callTool({ name: toolName, arguments: args })
        const content = result.content as Array<{ type: string; text?: string }>
        const text = content.map(item => item.text ?? '').join('\n')
        try { return JSON.parse(text) } catch { return { text } }
      } finally {
        await destroyMcpClients(entries)
      }
    },
  }))
  for (const scheduler of schedulers) scheduler.init()
  for (const owner of profiles.values()) if (owner.triggers?.cron) console.log(`[cron] registered schedule '${owner.triggers.cron}' for profile '${owner.name}'`)

  const restHandler = createRestHandler({ defaultProfile: profile, profiles, apiKey, runStore, abortRegistry, skills, channels, channelsForProfile: item => channelsByProfile.get(item.name), pendingStore, originPolicy })
  const httpServer = createServer((req, res) => { void restHandler(req, res) })
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, cb) => {
      const header = info.req.headers.origin
      const origin = typeof header === 'string' ? header : header ? '__invalid_origin__' : undefined
      const originResult = checkOrigin(origin, originPolicy)
      if (!originResult.ok) {
        console.warn(`[origin] rejected WebSocket upgrade: ${origin ?? 'missing'} (${originResult.reason})`)
        cb(false, 403, 'Forbidden')
        return
      }
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
    try {
      registerServer(serverRecordFor(PORT, profile.name, [...profiles.keys()], process.cwd()))
    } catch (error: any) {
      console.warn(`[server] unable to write process registry: ${error.message}`)
    }
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
    const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; name: string }>()
    const sessionApprovalGrants = new SessionApprovalGrants()
    const pendingInputRequests = new Map<string, (value: string) => void>()
    const pendingCodeExecutions = new Map<string, (result: any) => void>()
    const pendingRenders = new Map<string, (result: any) => void>()
    const agentControllers = new Map<string, AbortController>()

    const requestToolApproval = (sendForRun: (message: any) => void, id: string, name: string, input: Record<string, unknown>, risk?: 'safe' | 'caution' | 'danger', reason?: string, agentId?: string): Promise<boolean> => new Promise(resolve => {
      // This callback is reached only after ACL resolution produced a prompt.
      // Session grants never widen a deny decision; deny never reaches this path.
      const grant = sessionApprovalGrants.check(name, 'prompt')
      if (grant) {
        sendForRun({ type: 'tool_auto_approved', id, name: grant.name, scope: grant.scope })
        resolve(true)
        return
      }
      pendingApprovals.set(id, { resolve, name })
      sendForRun({ type: 'tool_prompt', id, name, input, risk, reason, ...(agentId ? { agent_id: agentId } : {}) })
    })

    const resolvePendingClientWork = (reason: string): void => {
      for (const [id, resolve] of pendingCodeExecutions) {
        resolve({ id, stdout: '', stderr: reason, exit_code: 1, files: {}, duration_ms: 0 })
      }
      pendingCodeExecutions.clear()
      for (const [id, resolve] of pendingRenders) {
        resolve({ id, ok: false, errors: [reason], duration_ms: 0, bytes: 0 })
      }
      pendingRenders.clear()
    }
    let mcpEntries: McpEntry[] = []
    let mcpLoaded = false
    let mcpIdleTimer: ReturnType<typeof setTimeout> | undefined
    let wasmSupported = false
    let audioSupported = false
    let voiceInput: VoiceInput | null = null
    let voiceTurn: VoiceTurn | null = null
    let voiceOutput: VoiceOutput | null = null
    let baseProfile = profile
    let connectionProfile = profile
    let connectionChannels = channels
    let connectionOpenai = openai
    let connectionImprover = improver
    let approvalMode: 'strict' | 'bash' | 'danger' | 'yolo' = 'danger'
    let approvalLimit: 'strict' | 'bash' | 'danger' | 'yolo' = 'danger'
    let connectionModel = profile.model.id
    let miningSkills = false
    let safetyDisclosed = false
    let protocolVersion = PROTOCOL_VERSION
    let connectionAgentTools: ToolDefinition[] = []
    let activeContext: ToolContext | undefined
    let operatorBudget: RunBudget | undefined

    const rebuildConnectionProfile = () => {
      connectionProfile = { ...baseProfile, model: { ...baseProfile.model, id: connectionModel } }
    }

    const activateProfile = async (name: string | undefined): Promise<string | null> => {
      const selected = name ? profiles.get(name) : profile
      if (!selected) return `unknown profile "${name}"; available: ${[...profiles.keys()].sort().join(', ')}`
      baseProfile = selected
      connectionProfile = selected
      approvalLimit = resolveApprovalLimit(connectionProfile)
      approvalMode = approvalLimit
      connectionModel = connectionProfile.model.id
      connectionOpenai = createProviderClient(connectionProfile)
      connectionImprover = new DefaultImprover(connectionProfile, connectionOpenai)
      connectionChannels = channelsByProfile.get(selected.name)!
      voiceInput?.cancel(); voiceInput = null
      voiceOutput?.cancel(); voiceOutput = null
      session = createSession(connectionProfile.name, userId)
      memory = connectionProfile.memory?.provider === 'graph'
        ? new GraphMemoryProvider(connectionProfile.artifact_dir, session)
        : new FsMemoryProvider(connectionProfile.artifact_dir, session)
      usageAtConnectionStart = { ...session.usage }
      await destroyMcpClients(mcpEntries).catch(() => {})
      mcpEntries = []
      mcpLoaded = false
      if (mcpIdleTimer) clearTimeout(mcpIdleTimer)
      void sweepDeferredLabels(session.user, session.project).catch(() => {})
      connectionAgentTools = await loadAgentTools(connectionProfile)
      operatorBudget = connectionProfile.triggers?.budget ? new RunBudget(connectionProfile.triggers.budget) : undefined
      activeContext = undefined
      return null
    }

    const ensureMcpClients = async (): Promise<void> => {
      if (mcpIdleTimer) { clearTimeout(mcpIdleTimer); mcpIdleTimer = undefined }
      if (mcpLoaded) return
      mcpLoaded = true
      try { mcpEntries = await createMcpClients(connectionProfile) }
      catch (error: any) { mcpLoaded = false; console.error('[mcp] init failed:', error.message) }
    }

    const closeMcpWhenIdle = (): void => {
      if (!mcpEntries.length || mcpIdleTimer) return
      const entries = mcpEntries
      mcpIdleTimer = setTimeout(() => {
        mcpIdleTimer = undefined
        if (mcpEntries !== entries) return
        mcpEntries = []
        mcpLoaded = false
        void destroyMcpClients(entries).catch(e => console.error('[mcp] idle close failed:', e.message))
      }, (connectionProfile.mcp?.idle_timeout_s ?? 900) * 1000)
      mcpIdleTimer.unref()
    }

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }

    const sendSessionReady = () => {
      const budget = connectionProfile.triggers?.budget
      send({
        type: 'session_ready', sessionId: session.id, profile: connectionProfile.name,
        model: connectionProfile.model.id, working_dir: connectionProfile.working_dir,
        allowed_packages: connectionProfile.executor?.allowed_packages ?? [],
        ...(budget ? { budget: { max_cost_usd: budget.max_cost_usd } } : {}),
        yolo: isYoloEnabled(approvalMode), protocol_version: protocolVersion,
      })
    }

    const cloneSession = (): typeof session => JSON.parse(JSON.stringify(session))

    const requestInput = (runId: string, prompt: string, kind: InputRequestKind, options?: string[], id: string = randomUUID(), agentId?: string): Promise<string> => new Promise(resolve => {
      pendingInputRequests.set(id, resolve)
      makeRunEmitter(runId, send)({ type: 'input_request', id, prompt, kind, options, ...(agentId ? { agent_id: agentId } : {}) })
    })

    const fleetEvents = (runId: string): AgentLoopEvents => {
      const sendForRun = makeRunEmitter(runId, send)
      return {
        onToken: (token, agentId) => sendForRun({ type: 'token', content: token, ...(agentId ? { agent_id: agentId } : {}) }),
        onToolStart: (id, name, input, agentId) => sendForRun({ type: 'tool_start', id, name, input, ...(agentId ? { agent_id: agentId } : {}) }),
        onToolEnd: (id, name, result, ok, agentId) => sendForRun({ type: 'tool_end', id, name, result, ok, ...(agentId ? { agent_id: agentId } : {}) }),
        onToolPrompt: (id, name, input, risk, reason, agentId) => requestToolApproval(sendForRun, id, name, input, risk, reason, agentId),
        onInputRequest: (id, prompt, kind, options, agentId) => requestInput(runId, prompt, kind, options, id, agentId),
        onSessionEnd: () => {},
        onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId) => sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) }),
        onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
        onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
        onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools }),
        onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
      }
    }

    const handlePlanRequest = async (request: string): Promise<void> => {
      const runId = randomRunId()
	  const sendForRun = makeRunEmitter(runId, send)
	  sendForRun({ type: 'turn_start' })
      runStore.create({ id: runId, profile: connectionProfile.name, user: userId, trigger: 'stream', input: request, status: 'running', started_at: new Date().toISOString() })
      await ensureMcpClients()
      const previewSession = cloneSession()
      const previewMemory = connectionProfile.memory?.provider === 'graph'
        ? new GraphMemoryProvider(connectionProfile.artifact_dir, previewSession)
        : new FsMemoryProvider(connectionProfile.artifact_dir, previewSession)
      if (previewSession.messages.length === 0) {
        previewSession.messages.push({
          role: 'system',
          content: await buildInteractiveSystemPrompt(connectionProfile, audioSupported, skillIndex, previewMemory),
        })
      }
      const planEvents: AgentLoopEvents = {
        onToken: () => {},
        onToolStart: (id, n, i, agentId) => sendForRun({ type: 'tool_start', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
        onToolEnd: (id, n, r, ok, agentId) => sendForRun({ type: 'tool_end', id, name: n, result: r, ok, ...(agentId ? { agent_id: agentId } : {}) }),
        onToolParked: (id, n, i, agentId) => sendForRun({ type: 'tool_parked', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
        onToolPrompt: (id, n, i, risk, reason, agentId) => requestToolApproval(sendForRun, id, n, i, risk, reason, agentId),
        onSessionEnd: () => {},
        onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId) => sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) }),
        onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
        onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
        onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools }),
        onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
        onInputRequest: (id, prompt, kind, options, agentId) => requestInput(runId, prompt, kind, options, id, agentId),
        onTodosUpdate: (todos, agentId) => sendForRun({ type: 'todos', todos, ...(agentId ? { agent_id: agentId } : {}) }),
        onStage: (stage, intensity, tier, model, state, cost_usd, agentId) => sendForRun({ type: 'stage', stage, intensity, tier, model, state, cost_usd, ...(agentId ? { agent_id: agentId } : {}) }),
      }
      try {
        const agentTools = await loadAgentTools(connectionProfile)
        const previewContext: ToolContext = {
          profile: connectionProfile, session: previewSession, workingDir: connectionProfile.working_dir, memory: previewMemory, skills, mcpEntries,
          events: planEvents, openai: connectionOpenai, signal: abortController.signal, delegateDepth: 0, agentTools,
          maxDepth: connectionProfile.max_depth ?? 2, wasmSupported, approvalMode, channels: connectionChannels, runId,
          pendingInputs: pendingStore,
          agentFrame: createRootFrame(connectionProfile.name, previewSession.id),
          protocolVersion,
          agentControllers,
        }
        const preview = await runPlanPreview(request, connectionProfile, previewSession, previewContext, planEvents, connectionOpenai, abortController.signal)
        sendForRun({ type: 'plan', content: preview.body })
        const choice = (await requestInput(runId, 'Plan ready — proceed, edit, or cancel?', 'select', ['proceed', 'edit', 'cancel'])).trim().toLowerCase()
        if (choice !== 'proceed' && choice !== 'edit') {
          runStore.update(runId, { status: 'completed', finished_at: new Date().toISOString() })
          sendForRun({ type: 'notice', level: 'info', message: 'plan cancelled', detail: 'no session or artifact changes made' })
          sendForRun({ type: 'session_end', sessionId: session.id })
          return
        }
        let planBody = preview.body
        if (choice === 'edit') {
          const edited = await requestInput(runId, 'Edit plan, then press enter (blank keeps generated plan).', 'text')
          if (edited.trim()) planBody = edited.trim()
        }
        await runApprovedPlanFollowOn(
          request,
          planBody,
          () => writeArtifact(connectionProfile, session, 'plan', planBody, {
            intensity: preview.intensity, tier: preview.tier, model: preview.model, contract_ok: preview.contract_ok, attempt: preview.attempt, task_id: preview.taskId,
          }),
          approvedMessage => {
            ws.emit('message', Buffer.from(JSON.stringify({ type: 'message', content: approvedMessage, skipWorkflow: true })), false)
          },
        )
        sendForRun({ type: 'artifacts', sessionId: session.id, artifacts: [{ id: `plan-${preview.taskId}`, kind: 'doc', title: 'Plan', icon: '🗺️', meta: 'approved plan', data: { path: `${connectionProfile.artifact_dir}/workflow/${session.id}/plan.md`, summary: planBody.split('\n')[0] ?? '' } }] })
        runStore.update(runId, { status: 'completed', session_id: session.id, finished_at: new Date().toISOString() })
      } catch (error: any) {
        runStore.update(runId, { status: 'failed', error: error.message, finished_at: new Date().toISOString() })
        sendForRun({ type: 'error', message: error.message })
      }
    }

    const sendSkills = () => send({ type: 'skills', proposed: listProposed(connectionProfile), installed: listInstalled() })
    const sendPending = () => send({
      type: 'pending',
      pending: pendingStore.list({ user: userId, state: 'open' }).map(({ path: _path, ...record }) => record),
    })

    const spawnOperatorAgents = async (msg: Extract<ClientMessage, { type: 'spawn' }>): Promise<void> => {
      const catalog = buildAgentCatalog(connectionProfile, [...profiles.values()])
      const entry = catalog.find(candidate => candidate.name === msg.agent)
      if (!entry) {
        send({ type: 'notice', level: 'error', message: `unknown agent "${msg.agent}"`, detail: 'request agents_list for available agents' })
        return
      }
      const count = msg.count ?? 1
      if (!Number.isInteger(count) || count < 1 || count > 32) {
        send({ type: 'notice', level: 'error', message: 'invalid spawn count', detail: 'count must be an integer from 1 to 32' })
        return
      }
      const input = { ...(msg.input ?? {}) }
      const promptValue = typeof input.prompt === 'string' ? input.prompt : typeof input.text === 'string' ? input.text : undefined
      if (entry.prompt_field && promptValue !== undefined && input[entry.prompt_field] === undefined) input[entry.prompt_field] = promptValue

      const parentContext = activeContext
      const parentBudget = parentContext?.budget ?? operatorBudget
      const requestedBudget = msg.budget_usd ?? entry.budget_usd
      const implicitShare = parentBudget ? parentBudget.remainingCost() / count : undefined
      if (requestedBudget !== undefined && parentBudget) {
        const remainder = parentBudget.remainingCost()
        if (requestedBudget * count > remainder) {
          send({ type: 'notice', level: 'warn', message: `spawn refused: budget ${requestedBudget * count} USD exceeds parent remainder ${remainder.toFixed(4)} USD`, detail: `requested ${requestedBudget.toFixed(4)} USD × ${count}; parent used ${(parentBudget.config.max_cost_usd - remainder).toFixed(4)} USD of ${parentBudget.config.max_cost_usd.toFixed(4)} USD` })
          return
        }
      }

      await ensureMcpClients()
      const runId = parentContext?.runId ?? randomRunId()
      const context: ToolContext = parentContext
        ? { ...parentContext, signal: abortController.signal, agentOrigin: 'operator', taintSources: session.taint_sources, agentControllers }
        : {
            profile: connectionProfile, session, workingDir: connectionProfile.working_dir, memory, skills, mcpEntries,
            events: fleetEvents(runId), openai: connectionOpenai, signal: abortController.signal, delegateDepth: 0,
            agentTools: connectionAgentTools, maxDepth: connectionProfile.max_depth ?? 2, wasmSupported, approvalMode,
            channels: connectionChannels, runId, pendingInputs: pendingStore, budget: operatorBudget,
            agentFrame: createRootFrame(connectionProfile.name, session.id), protocolVersion,
            agentOrigin: 'operator', agentControllers,
          }
      context.agentOrigin = 'operator'

      const namedTool = connectionAgentTools.find(tool => tool.name === msg.agent && tool.name !== 'DelegateFanout')
      const executor = namedTool
        ? async (childInput: Record<string, unknown>, childContext: ToolContext) => namedTool.execute(childInput, childContext)
        : !((connectionProfile.agents ?? []).some(agent => agent.name === entry.name)) && profiles.has(entry.profile)
          ? async (childInput: Record<string, unknown>, childContext: ToolContext) => delegateTool.execute({ profile: entry.profile, task: String(childInput[entry.prompt_field ?? 'task'] ?? '') }, childContext)
          : undefined
      if (!executor) {
        send({ type: 'notice', level: 'error', message: `agent "${msg.agent}" is not executable`, detail: 'agent catalog is stale; request agents_list again' })
        return
      }

      const settled = await runBoundedPool(
        Array.from({ length: count }, () => ({
          key: msg.agent,
          maxConcurrent: entry.max_concurrent,
          run: async childContext => {
            const childBudgetLimit = requestedBudget ?? implicitShare
            const childBudget = parentBudget && childBudgetLimit !== undefined ? parentBudget.allocate(childBudgetLimit) : undefined
            try {
              return await executor(input, childBudget ? { ...childContext, budget: childBudget } : childContext)
            } finally {
              childBudget?.release()
            }
          },
        })),
        context,
        3,
      )
      for (const result of settled) {
        if (result.status === 'rejected') {
          send({ type: 'notice', level: 'error', message: `spawn failed for "${msg.agent}"`, detail: result.reason instanceof Error ? result.reason.message : String(result.reason) })
        } else if (typeof result.value === 'string' && result.value.startsWith('Error:')) {
          send({ type: 'notice', level: 'error', message: `spawn refused for "${msg.agent}"`, detail: result.value })
        } else if (result.value && typeof result.value === 'object' && 'content' in result.value && String(result.value.content).startsWith('Error:')) {
          send({ type: 'notice', level: 'error', message: `spawn refused for "${msg.agent}"`, detail: String(result.value.content) })
        }
      }
    }

    ws.on('message', async (raw, isBinary) => {
      if (isBinary) {
        if (!audioSupported || !voiceInput) { send({ type: 'error', message: 'audio chunk received without an active audio session' }); return }
        voiceInput.push(new Uint8Array(raw as Buffer))
        return
      }
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        send({ type: 'error', message: 'Invalid JSON' })
        return
      }

      if (msg.type === 'hello') {
		const requestedProtocolVersion = msg.protocol_version ?? 1
		if (requestedProtocolVersion !== 2 && requestedProtocolVersion !== PROTOCOL_VERSION) {
		  send({ type: 'error', message: `Unsupported protocol version ${requestedProtocolVersion}; client must use version 2 or ${PROTOCOL_VERSION}.` })
		  return
		}
		protocolVersion = requestedProtocolVersion
        // Only honour hello before the session has any messages
        if (session.messages.length === 0) {
          userId = sanitizeUserId(msg.user_id)
          wasmSupported = msg.wasm_supported ?? false
          audioSupported = msg.audio_supported ?? false
          const error = await activateProfile(msg.profile)
          if (error) { send({ type: 'error', message: error }); return }
        }
        sendSessionReady()
        send({ type: 'approval_mode_changed', mode: approvalMode })
        sendPending()
        return
      }

      if (msg.type === 'set_profile') {
        const error = await activateProfile(msg.profile)
        if (error) { send({ type: 'error', message: error }); return }
        sendSessionReady()
        send({ type: 'approval_mode_changed', mode: approvalMode })
        sendPending()
        return
      }

      if (msg.type === 'agents_list') {
        send({ type: 'agent_catalog', agents: buildAgentCatalog(connectionProfile, [...profiles.values()]) })
        return
      }

      if (msg.type === 'spawn') {
        await spawnOperatorAgents(msg)
        return
      }

      if (msg.type === 'agent_cancel') {
        const controller = agentControllers.get(msg.agent_id)
        if (controller) {
          controller.abort()
          send({ type: 'notice', level: 'info', message: `agent ${msg.agent_id} cancelled` })
        } else {
          send({ type: 'notice', level: 'warn', message: `agent ${msg.agent_id} is not running` })
        }
        return
      }

      if (msg.type === 'audio_start') {
        if (!audioSupported) { send({ type: 'error', message: 'client did not negotiate audio support' }); return }
        const configured = connectionProfile.voice?.stt
        const provider = configured ? resolveVoiceProvider(configured.provider) : undefined
        if (!provider?.stt) { send({ type: 'error', message: 'voice STT provider is not configured or unavailable' }); return }
        voiceInput?.cancel()
        voiceTurn = new VoiceTurn(() => abortController.abort(), () => {
          voiceInput?.cancel(); voiceInput = null
          voiceOutput?.cancel(); voiceOutput = null
          send({ type: 'audio_out_end', reason: 'interrupted' })
        })
        voiceInput = new VoiceInput(provider.stt, {
          codec: msg.codec,
          sample_rate: msg.sample_rate,
          silence_ms: connectionProfile.voice?.endpointing.silence_ms,
          max_utterance_s: connectionProfile.voice?.endpointing.max_utterance_s,
        }, part => {
          send({ type: 'transcript_partial', ...part })
          if (part.final && part.text.trim()) queueMicrotask(() => ws.emit('message', Buffer.from(JSON.stringify({ type: 'message', content: part.text })), false))
        })
        voiceInput.start()
        return
      }

      if (msg.type === 'audio_end') { voiceInput?.end(); return }

      if (msg.type === 'barge_in') {
        if (voiceTurn) voiceTurn.bargeIn()
        else {
          voiceInput?.cancel(); voiceInput = null
          voiceOutput?.cancel(); voiceOutput = null
          abortController.abort()
          send({ type: 'audio_out_end', reason: 'interrupted' })
        }
        voiceTurn = null
        abortController = new AbortController()
        return
      }

      if (msg.type === 'pending_list') {
        sendPending()
        return
      }

      if (msg.type === 'undo_list') {
        send({ type: 'undo_entries', entries: listUndoEntries(userId, session.id) })
        return
      }

      if (msg.type === 'undo_apply') {
        const notice = await undoNotice(userId, session.id, msg.id, connectionProfile, msg.force, msg.reason)
        send({ type: 'notice', level: notice.level, message: notice.message })
        send({ type: 'undo_entries', entries: listUndoEntries(userId, session.id) })
        return
      }

      if (msg.type === 'pending_answer') {
        const pending = pendingStore.get(msg.pending_id)
        if (!pending) {
          send({ type: 'error', message: 'This request has expired or was already answered.' })
          return
        }
        const resumedRunId = pending.run_id
		const sendForRun = makeRunEmitter(resumedRunId, send)
		sendForRun({ type: 'turn_start' })
        const result = await resumePendingInput(msg.pending_id, msg.value, 'ws', {
          pendingStore, runStore, abortRegistry,
          resolveProfile: name => profiles.get(name) ?? null,
          channels: connectionChannels,
          protocolVersion,
          events: {
            onToken: (t, agentId) => sendForRun({ type: 'token', content: t, ...(agentId ? { agent_id: agentId } : {}) }),
            onToolStart: (id, n, i, agentId) => sendForRun({ type: 'tool_start', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
            onToolEnd: (id, n, r, ok, agentId) => sendForRun({ type: 'tool_end', id, name: n, result: r, ok, ...(agentId ? { agent_id: agentId } : {}) }),
            onToolParked: (id, n, i, agentId) => sendForRun({ type: 'tool_parked', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
            onToolPrompt: (id, n, i, risk, reason, agentId) => requestToolApproval(sendForRun, id, n, i, risk, reason, agentId),
            onSessionEnd: id => sendForRun({ type: 'session_end', sessionId: id }),
            onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId) => sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) }),
            onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
            onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
            onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools }),
            onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
            onInputRequest: (id, prompt, kind, options, agentId) => requestInput(resumedRunId, prompt, kind, options, id, agentId),
          },
        })
        if (result.status === 'failed' || result.status === 'ignored') {
          sendForRun({ type: 'error', message: result.status === 'failed' ? result.error : result.reason })
        }
        sendPending()
        return
      }

      if (msg.type === 'set_approval_mode') {
        const requested = resolveRequestedApprovalMode(msg.mode, approvalLimit)
        if (!requested) {
          send({ type: 'notice', level: 'error', message: 'unknown approval mode', detail: 'use strict, bash, danger, or yolo' })
          return
        }
        if (!requested.ok) {
          send({ type: 'notice', level: 'warn', message: `approval mode ${msg.mode} exceeds the server limit`, detail: `maximum allowed mode is ${approvalLimit}` })
          return
        }
        approvalMode = requested.mode
        send({ type: 'approval_mode_changed', mode: approvalMode })
        return
      }

      if (msg.type === 'models_list') {
        const activeProfile = { ...baseProfile, model: { ...baseProfile.model, id: connectionModel } }
        send({ type: 'models', models: listModels(activeProfile), current: connectionModel })
        return
      }

      if (msg.type === 'profiles_list') {
        const available = [...profiles.values()].map(item => ({ name: item.name, description: item.description, mode: item.mode }))
          .sort((a, b) => a.name.localeCompare(b.name))
        send({ type: 'profiles', profiles: available, current: connectionProfile.name })
        return
      }

      if (msg.type === 'set_model') {
        const candidate = listModels(baseProfile).find(model => model.id === msg.model)
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

      if (msg.type === 'commands_list') {
        // Refresh on request so a command added under .agents/commands appears
        // without restarting the server.
        send({ type: 'commands', commands: commandSummaries(loadAllCommands(resolveCommandDirs())) })
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
          await connectionImprover.mineSkills([session])
          sendSkills()
        } catch (error: any) {
          send({ type: 'notice', level: 'error', message: 'skills mining failed', detail: error.message })
        } finally {
          miningSkills = false
        }
        return
      }

      if (msg.type === 'compact') {
        const before = estimateTokens(await project(session, connectionProfile, connectionOpenai, memory))
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
            project_files: connectionProfile.context?.project_files ?? true,
          },
        }
        const afterProjection = await project(session, compactProfile, connectionOpenai, memory)
        const after = estimateTokens(afterProjection, session)
        saveSession(session)
        send({ type: 'stats', tokens_in: session.usage.input, tokens_out: session.usage.output, cost_usd: session.usage.cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens: after })
        send({ type: 'notice', level: 'info', message: before > after ? `compacted context · ${before - after} tokens saved` : 'context already compact', detail: before > after ? `${before} → ${after} tokens` : 'no condensation needed' })
        return
      }

      if (msg.type === 'cancel') {
        abortController.abort()
        for (const controller of agentControllers.values()) controller.abort()
        agentControllers.clear()
        abortController = new AbortController()
		for (const pending of pendingApprovals.values()) pending.resolve(false)
		pendingApprovals.clear()
        sessionApprovalGrants.clear()
		for (const resolve of pendingInputRequests.values()) resolve('')
		pendingInputRequests.clear()
        resolvePendingClientWork('Client cancelled the request.')
        return
      }

      if (msg.type === 'tool_approve' || msg.type === 'tool_deny') {
        const pending = pendingApprovals.get(msg.id)
        if (pending) {
          pendingApprovals.delete(msg.id)
          if (msg.type === 'tool_approve' && msg.remember) sessionApprovalGrants.remember(pending.name, 'prompt')
          pending.resolve(msg.type === 'tool_approve')
        }
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

      if (msg.type === 'ui_result') {
        const cb = pendingRenders.get(msg.id)
        if (cb) {
          pendingRenders.delete(msg.id)
          cb({
            id: msg.id,
            ok: msg.ok !== false,
            errors: Array.isArray(msg.errors) ? msg.errors.slice(0, 20).map(String) : [],
            stdout: typeof msg.stdout === 'string' ? msg.stdout.slice(0, 8000) : undefined,
            duration_ms: Number(msg.duration_ms) || 0,
            bytes: Number(msg.bytes) || 0,
          })
        }
        return
      }

      if (msg.type === 'plan_request') {
        await handlePlanRequest(msg.content)
        return
      }

      if (msg.type === 'resume') {
        const loaded = loadSession(userId, msg.sessionId)
        if (loaded) {
          session = loaded
          baseProfile = profiles.get(loaded.profile) ?? baseProfile
          connectionProfile = baseProfile
          connectionOpenai = createProviderClient(connectionProfile)
          connectionImprover = new DefaultImprover(connectionProfile, connectionOpenai)
          connectionAgentTools = await loadAgentTools(connectionProfile)
          operatorBudget = connectionProfile.triggers?.budget ? new RunBudget(connectionProfile.triggers.budget) : undefined
          activeContext = undefined
          memory = connectionProfile.memory?.provider === 'graph'
            ? new GraphMemoryProvider(connectionProfile.artifact_dir, session)
            : new FsMemoryProvider(connectionProfile.artifact_dir, session)
          usageAtConnectionStart = { ...session.usage }
          send({ type: 'session_resumed', sessionId: session.id })
        } else {
          send({ type: 'error', message: `Session ${msg.sessionId} not found` })
        }
        return
      }

      const projectReply = handleProjectMessage(msg, userId)
      if (projectReply) { send(projectReply); return }

      if (msg.type === 'message' && msg.content.trimStart().startsWith('/spawn ')) {
        const [, agent, ...words] = msg.content.trim().split(/\s+/)
        await spawnOperatorAgents({ type: 'spawn', agent, input: { prompt: words.join(' ') } })
        return
      }

      if (msg.type === 'message') {
        const runId = randomRunId()
        const sendForRun = makeRunEmitter(runId, send)
        const runSignal = abortController.signal
        const budget = connectionProfile.triggers?.budget
          ? new RunBudget(connectionProfile.triggers.budget)
          : undefined
        let terminalStatus: SessionEndStatus = 'completed'
        let terminalReason: string | undefined
        sendForRun({ type: 'turn_start' })
        runStore.create({
          id: runId, profile: connectionProfile.name, user: userId, trigger: 'stream',
          input: msg.content, status: 'running', started_at: new Date().toISOString(),
        })
        // Build system prompt with memory on first turn
        if (session.messages.length === 0) {
          session.messages.push({
            role: 'system',
            content: await buildInteractiveSystemPrompt(connectionProfile, audioSupported, skillIndex, memory),
          })
        }

        const configuredTts = audioSupported && connectionProfile.voice?.tts
          ? resolveVoiceProvider(connectionProfile.voice.tts.provider)?.tts
          : undefined
        voiceOutput?.cancel()
        voiceOutput = configuredTts
          ? new VoiceOutput(configuredTts, { sample_rate: Number(connectionProfile.voice?.tts?.config.sample_rate) || 24_000 }, {
              start: () => send({ type: 'audio_out_start', codec: 'pcm16', sample_rate: Number(connectionProfile.voice?.tts?.config.sample_rate) || 24_000 }),
              chunk: data => { if (ws.readyState === ws.OPEN) ws.send(data, { binary: true }) },
              end: reason => send({ type: 'audio_out_end', reason }),
            })
          : null
        voiceOutput?.start()
        const events: AgentLoopEvents = {
          onToken: (t, agentId) => { sendForRun({ type: 'token', content: t, ...(agentId ? { agent_id: agentId } : {}) }); voiceOutput?.push(t) },
          onToolStart: (id, n, i, agentId) => sendForRun({ type: 'tool_start', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
          onToolEnd: (id, n, r, ok, agentId) => sendForRun({ type: 'tool_end', id, name: n, result: r, ok, ...(agentId ? { agent_id: agentId } : {}) }),
          onToolParked: (id, n, i, agentId) => sendForRun({ type: 'tool_parked', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
          onToolPrompt: (id, n, i, risk, reason, agentId) => requestToolApproval(sendForRun, id, n, i, risk, reason, agentId),
          onSessionEnd: (id) => {
            voiceOutput?.end()
            saveSession(session)
            const status = runSignal.aborted ? 'cancelled' : terminalStatus
            sendForRun({ type: 'session_end', sessionId: id, status, ...(terminalReason ? { reason: terminalReason } : {}) })
            closeMcpWhenIdle()
          },
          onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId) => {
            sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) })
          },
          onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
          onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
          onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools }),
          onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
          onSafetyNotice: (classifierModel) => {
            if (safetyDisclosed) return
            safetyDisclosed = true
            sendForRun({ type: 'notice', level: 'info', message: `ambiguous tools classified by ${classifierModel}`, detail: 'verdicts are cached · set safety.enabled: false or use /approval bash to opt out' })
          },
          onNotice: (level, message, detail, agentId) => sendForRun({ type: 'notice', level, message, detail, ...(agentId ? { agent_id: agentId } : {}) }),
          onArtifacts: (sessionId, artifacts, agentId) => {
            sendForRun({ type: 'artifacts', sessionId, artifacts, ...(agentId ? { agent_id: agentId } : {}) })
          },
          onInputRequest: (id, prompt, kind, options, agentId) => requestInput(runId, prompt, kind, options, id, agentId),
          onTodosUpdate: (todos, agentId) => {
            sendForRun({ type: 'todos', todos, ...(agentId ? { agent_id: agentId } : {}) })
          },
          onCodeExecute: (id, code, language, data, agentId) => new Promise(resolve => {
            pendingCodeExecutions.set(id, resolve)
            sendForRun({ type: 'code_execute', id, code, language, data, ...(agentId ? { agent_id: agentId } : {}) })
          }),
          onRenderUI: (surface, agentId) => new Promise(resolve => {
            pendingRenders.set(surface.id, resolve)
            sendForRun({ type: 'ui_render', surface, ...(agentId ? { agent_id: agentId } : {}) })
          }),
          onStage: (stage, intensity, tier, model, state, cost_usd, agentId) => sendForRun({ type: 'stage', stage, intensity, tier, model, state, cost_usd, ...(agentId ? { agent_id: agentId } : {}) }),
        }
        await ensureMcpClients()
        const agentTools = await loadAgentTools(connectionProfile)
        const context: ToolContext = {
          profile: connectionProfile, session, workingDir: connectionProfile.working_dir, memory, skills, mcpEntries,
          events, openai: connectionOpenai, signal: runSignal, delegateDepth: 0,
          agentTools,
          maxDepth: connectionProfile.max_depth ?? 2,
          wasmSupported,
          approvalMode,
          channels: connectionChannels,
          runId,
          pendingInputs: pendingStore,
          budget,
          agentFrame: createRootFrame(connectionProfile.name, session.id),
          protocolVersion,
          agentControllers,
        }
        activeContext = context

        try {
          await runInteractiveTurn(msg.content, connectionProfile, session, context, events, connectionOpenai, runSignal, msg.skipWorkflow)
          terminalStatus = runSignal.aborted ? 'cancelled' : 'completed'
          runStore.update(runId, { status: terminalStatus, session_id: session.id, finished_at: new Date().toISOString() })
          if (runSignal.aborted) {
            saveSession(session)
            sendForRun({ type: 'session_end', sessionId: session.id, status: terminalStatus })
          }
        } catch (e: any) {
          voiceOutput?.end()
          if (isParkSignal(e)) {
            runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
            sendPending()
            return
          }
          const outcome = sessionEndFromError(e, runSignal.aborted)
          terminalStatus = outcome.status
          terminalReason = outcome.reason
          runStore.update(runId, { status: outcome.status === 'budget_exceeded' ? 'budget_exceeded' : outcome.status === 'cancelled' ? 'cancelled' : 'failed', error: e.message, finished_at: new Date().toISOString() })
          if (e.name !== 'AbortError') {
            sendForRun({ type: 'error', message: e.message })
          }
		  if (runSignal.aborted || e instanceof BudgetExceeded) {
		    saveSession(session)
		    sendForRun({ type: 'session_end', sessionId: session.id, status: terminalStatus, ...(terminalReason ? { reason: terminalReason } : {}) })
		  }
        }
      }
    })

    ws.on('close', () => {
      openSockets.delete(ws)
	  for (const pending of pendingApprovals.values()) pending.resolve(false)
	  pendingApprovals.clear()
      sessionApprovalGrants.clear()
	  for (const resolve of pendingInputRequests.values()) resolve('')
	  pendingInputRequests.clear()
      resolvePendingClientWork('Client disconnected before completion.')
      saveSession(session)
      const connectionDelta = {
        input: session.usage.input - usageAtConnectionStart.input,
        output: session.usage.output - usageAtConnectionStart.output,
        cost_usd: session.usage.cost_usd - usageAtConnectionStart.cost_usd,
      }
      recordUsage(session.user, connectionDelta)

      // Destroy per-connection MCP clients (fire-and-forget)
      if (mcpIdleTimer) clearTimeout(mcpIdleTimer)
      void destroyMcpClients(mcpEntries).catch(e => console.error('[mcp] destroy error:', e.message))

      // on_stop hooks (fire-and-forget — close handler cannot be async)
      void runHooks('on_stop', connectionProfile, { SESSION_ID: session.id, PROFILE: connectionProfile.name })
        .catch(e => console.error('[on_stop hook] error:', e.message))

      // self-improvement (fire-and-forget)
      const userTurns = (session.messages as any[]).filter(m => m.role === 'user').length
      if (userTurns >= 2 && connectionProfile.improvement?.enabled) {
        void connectionImprover.reflect(session, memory).catch(e =>
          console.error('[improver] reflect failed:', e.message)
        )

        const mineEvery = connectionProfile.improvement?.mine_skills_every_n_sessions ?? 10
        let count = readSessionCount(connectionProfile.artifact_dir) + 1
        if (count >= mineEvery) {
          count = 0
          void connectionImprover.mineSkills([session]).catch(e =>
            console.error('[improver] mineSkills failed:', e.message)
          )
        }
        writeSessionCount(connectionProfile.artifact_dir, count)
      }
    })
    ws.on('error', (e) => console.error('ws error:', e.message))
  })

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    unregisterServer(PORT)
    console.log('\nShutting down...')
    await Promise.all(schedulers.map(scheduler => scheduler.stop()))
    for (const ws of openSockets) ws.terminate()  // triggers 'close' event → destroyMcpClients fires
    wss.close()
    httpServer.close()
    await Promise.all([...channelsByProfile.values()].map(runtime => runtime.stop()))
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(e => { console.error(e); process.exit(1) })
