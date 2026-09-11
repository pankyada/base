import { createServer } from 'http'
import { randomUUID } from 'crypto'
import { createRestHandler } from './rest.js'
import { checkOrigin, loadOriginPolicy } from './origin.js'
import { WebSocketServer, WebSocket } from 'ws'
import { resolve } from 'path'
import { homedir, userInfo } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { sanitizeUserId, userPaths } from '../session/user-paths.js'
import { mergeUsageDelta, recordUsage, usageDeltaFromSession } from '../usage/ledger.js'
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
import { createProvider } from '../provider/factory.js'
import type { ProviderClient } from '../provider/types.js'
import { bindRunProvider } from '../provider/invocation.js'
import { createMcpClients, destroyMcpClients, McpEntry } from '../mcp/client.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { MemoryProvider } from '../memory/interface.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { commandSummaries, loadAllCommands, resolveCommandDirs } from '../skills/commands.js'
import { registerAll, clearRegistry, registerTool } from '../tools/builtin/index.js'
import { getAllTools } from '../tools/registry.js'
import { resolveToolsDirs, loadAllCustomTools } from '../tools/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { buildInteractiveSystemPrompt } from './interactive-prompt.js'
import { listProposed, listInstalled, readSkill, writeSkill, promoteSkill, discardSkill } from '../skills/manage.js'
import { runPlanPreview } from '../workflow/runner.js'
import { runApprovedPlanFollowOn, runInteractiveTurn } from './turn-runner.js'
import { writeArtifact } from '../workflow/artifacts.js'
import { sweepDeferredLabels } from '../workflow/labeler.js'
import { discoverProfileModels } from '../models/discovery.js'
import { listModels, validateModelEffort } from '../models/registry.js'
import { project } from '../context/projection.js'
import { contextWindowFor, estimateTokens } from '../context/estimator.js'
import type { AgentLoopEvents, ToolContext, ToolDefinition } from '../tools/types.js'
import { ClientMessage, ServerMessage, PROTOCOL_VERSION, type EffortCapability, type InputRequestKind, type UsageMetadataWire } from '../types.js'
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
import { Bulletin } from '../agents/bulletin.js'
import { postBoardMessage } from './board-handler.js'
import pkg from '../../package.json' with { type: 'json' }
import { SessionRuntimeRegistry } from './session-runtime.js'
import { MissionStore, completeHumanCriterion, createMission, evidenceRef, evaluateCriterion, finalizeMission, type EvidenceRef } from '../missions/index.js'
import { ReplayStore } from '../replay/store.js'
import { hashArguments, markCheckpoint, newJournal, recordEffect, recordEvent, type EffectReceipt, type RunJournal } from '../replay/index.js'
import { ChallengeDesk } from '../agents/challenges.js'
import { ArtifactStore, promoteArtifact } from '../artifacts/index.js'
import { createArtifactGenerator } from '../artifacts/runtime.js'
import { codexAuthStatus } from '../provider/auth/store.js'

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

function usageMetadata(usage: object | undefined): UsageMetadataWire | undefined {
  if (!usage) return undefined
  const values = usage as Record<string, unknown>
  const keys: Array<keyof UsageMetadataWire> = ['billing_mode', 'cost_basis', 'billed_cost_usd', 'api_estimate_usd', 'api_equivalent_usd', 'usage_status', 'cached_input_tokens', 'reasoning_output_tokens', 'model_attempts']
  const result: Partial<UsageMetadataWire> = {}
  for (const key of keys) if (values[key] !== undefined) (result as Record<string, unknown>)[key] = values[key]
  return Object.keys(result).length ? result : undefined
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

function currentCodexGeneration(): string | undefined {
  try { return codexAuthStatus().generation } catch { return undefined }
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

  const provider = createProvider(profile)
  const openai = profile.model.auth === 'codex_oauth' ? undefined : createProviderClient(profile)
  const improver = new DefaultImprover(profile, openai, provider)
  const skills = loadAllSkills(resolveSkillsDirs())
  const skillIndex = buildSkillIndex(skills)
  const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')

  const apiKey = process.env.HARNESS_API_KEY?.trim() || undefined
  if (process.env.HARNESS_API_KEY !== undefined && !apiKey) {
    console.warn('[auth] HARNESS_API_KEY is set but empty — ignoring, server is unauthenticated')
  }

  const schedulers = [...profiles.values()].map(owner => new TriggerManager({
    profile: owner, runStore, abortRegistry, channels: channelsByProfile.get(owner.name), pendingStore,
    probe: async (tool, args, signal) => {
      const [serverName, toolName] = tool.split('__', 2)
      const entries = await createMcpClients(owner)
      try {
        const entry = entries.find(candidate => candidate.serverName === serverName && candidate.tools.some(candidateTool => candidateTool.name === toolName))
        if (!entry || !toolName) throw new Error(`poll probe tool "${tool}" is unavailable`)
        const result = await entry.client.callTool({ name: toolName, arguments: args }, undefined, { signal })
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

  const restHandler = createRestHandler({ defaultProfile: profile, profiles, apiKey, runStore, abortRegistry, skills, channels, channelsForProfile: item => channelsByProfile.get(item.name), pendingStore, originPolicy, artifactGenerator: createArtifactGenerator(skills) })
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
  const sessionRuntimes = new SessionRuntimeRegistry()
  const runtimePeers = new Map<string, Set<WebSocket>>()
  const addRuntimePeer = (sessionId: string, socket: WebSocket): void => { const peers = runtimePeers.get(sessionId) ?? new Set<WebSocket>(); peers.add(socket); runtimePeers.set(sessionId, peers) }
  const removeRuntimePeer = (sessionId: string, socket: WebSocket): void => { const peers = runtimePeers.get(sessionId); peers?.delete(socket); if (peers?.size === 0) runtimePeers.delete(sessionId) }
  const runtimeCleanupTimer = setInterval(() => sessionRuntimes.cleanup(), 30_000)
  runtimeCleanupTimer.unref()

  wss.on('connection', (ws: WebSocket) => {
    openSockets.add(ws)
    let userId = sanitizeUserId(process.env.HARNESS_USER ?? userInfo().username)
    let challengeDesk = new ChallengeDesk(3, 1, join(userPaths(userId, '').missionsDir, 'challenges.json'))
    let session = createSession(profile.name, userId)
    // Runtime owns lifecycle beyond this socket; disconnect cleanup is bounded.
    let sessionRuntime = sessionRuntimes.getOrCreate(session.id, userId)
    addRuntimePeer(session.id, ws)
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

    const requestToolApproval = async (sendForRun: (message: any) => void, id: string, name: string, input: Record<string, unknown>, risk?: 'safe' | 'caution' | 'danger', reason?: string, agentId?: string): Promise<boolean> => new Promise(resolve => {
      // This callback is reached only after ACL resolution produced a prompt.
      // Session grants never widen a deny decision; deny never reaches this path.
      const grant = sessionApprovalGrants.check(name, 'prompt')
      if (grant) {
        sendForRun({ type: 'tool_auto_approved', id, name: grant.name, scope: grant.scope })
        resolve(true)
        return
      }
      pendingApprovals.set(id, { resolve, name })
      const tool = getAllTools().find(item => item.name === name) ?? connectionAgentTools.find(item => item.name === name)
      let preview: unknown
      if (tool?.preview && activeContext) {
        void tool.preview(input, activeContext).then(value => sendForRun({ type: 'tool_prompt', id, name, input, risk, reason, preview: value, ...(agentId ? { agent_id: agentId } : {}) })).catch((error: any) => sendForRun({ type: 'tool_prompt', id, name, input, risk, reason, preview: { state: 'preview_failed', reason: error.message }, ...(agentId ? { agent_id: agentId } : {}) }))
      } else sendForRun({ type: 'tool_prompt', id, name, input, risk, reason, ...(agentId ? { agent_id: agentId } : {}) })
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
    let connectionProvider: ProviderClient = provider
    let connectionRawProvider: ProviderClient = provider
    let connectionImprover = improver
    let approvalMode: 'strict' | 'bash' | 'danger' | 'yolo' = 'danger'
    let approvalLimit: 'strict' | 'bash' | 'danger' | 'yolo' = 'danger'
    let connectionModel = profile.model.id
    let connectionEffort: string | null = profile.model.reasoning_effort ?? (profile.model.auth === 'codex_oauth' ? profile.model.codex.reasoning_effort ?? null : null)
    let connectionModels = listModels(profile)
    let connectionEffortCapability: EffortCapability | undefined = connectionModels.find(model => model.id === connectionModel)?.effort
    let modelCatalogGeneration: string | undefined = profile.model.auth === 'codex_oauth' ? currentCodexGeneration() : undefined
    let modelCatalogRequest = 0
    let modelSelectionRequest = 0
    let miningSkills = false
    let safetyDisclosed = false
    let protocolVersion = PROTOCOL_VERSION
    let connectionAgentTools: ToolDefinition[] = []
    let activeContext: ToolContext | undefined
    const maintenanceControllers = new Set<AbortController>()
    const maintenanceControllerByContext = new WeakMap<ToolContext, AbortController>()
    let operatorBudget: RunBudget | undefined
    let bulletin = new Bulletin()
    let activeMissionId: string | undefined
    let missionEvidence: EvidenceRef[] = []
    let controllerId = randomUUID()
    let controllerLease: string | undefined
    let observerOnly = false
    // Correlation is opt-in. Keep the request-to-action binding per socket so
    // a replayed request can return its cached result, while reuse for a
    // different action fails closed.
    const correlatedDecisionActions = new Map<string, string>()
    const runCorrelatedDecision = <T>(actionId: string, requestId: unknown, handler: () => T): T => {
      if (requestId === undefined) return handler()
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 256) throw new Error('invalid request id')
      const previous = correlatedDecisionActions.get(requestId)
      if (previous && previous !== actionId) throw new Error('request id already used for another action')
      correlatedDecisionActions.set(requestId, actionId)
      if (!controllerLease) throw new Error('controller lease required')
      return sessionRuntime.respond(requestId, controllerId, controllerLease, handler)
    }
    try { controllerLease = sessionRuntime.claim(controllerId).lease } catch { /* another controller may own an attached session */ }

    const rebuildConnectionProfile = () => {
      const model = { ...baseProfile.model, id: connectionModel, reasoning_effort: connectionEffort ?? undefined,
        ...(baseProfile.model.auth === 'codex_oauth' ? { codex: { ...baseProfile.model.codex, reasoning_effort: connectionEffort ?? undefined } } : {}) }
      connectionProfile = { ...baseProfile, model }
      connectionProvider = createProvider(connectionProfile, { effortCapability: connectionEffortCapability })
      connectionRawProvider = connectionProvider
      connectionOpenai = connectionProfile.model.auth === 'codex_oauth' ? undefined : createProviderClient(connectionProfile)
      connectionImprover = new DefaultImprover(connectionProfile, connectionOpenai, connectionProvider)
    }

    const flushConnectionUsage = (): void => {
      const delta = usageDeltaFromSession(usageAtConnectionStart, session.usage)
      saveSession(session)
      recordUsage(session.user, delta)
      usageAtConnectionStart = { ...session.usage }
    }

    const activateProfile = async (name: string | undefined): Promise<string | null> => {
      const selected = name ? profiles.get(name) : profile
      if (!selected) return `unknown profile "${name}"; available: ${[...profiles.keys()].sort().join(', ')}`
      flushConnectionUsage()
      baseProfile = selected
      connectionModels = listModels(selected)
      connectionEffortCapability = connectionModels.find(model => model.id === selected.model.id)?.effort
      modelCatalogGeneration = selected.model.auth === 'codex_oauth' ? currentCodexGeneration() : undefined
      modelCatalogRequest += 1
      modelSelectionRequest += 1
      connectionProfile = selected
      approvalLimit = resolveApprovalLimit(connectionProfile)
      approvalMode = approvalLimit
      connectionModel = connectionProfile.model.id
      connectionEffort = connectionProfile.model.reasoning_effort ?? (connectionProfile.model.auth === 'codex_oauth' ? connectionProfile.model.codex.reasoning_effort ?? null : null)
      connectionProvider = createProvider(connectionProfile, { effortCapability: connectionEffortCapability })
      connectionRawProvider = connectionProvider
      connectionOpenai = connectionProfile.model.auth === 'codex_oauth' ? undefined : createProviderClient(connectionProfile)
      connectionImprover = new DefaultImprover(connectionProfile, connectionOpenai, connectionProvider)
      connectionChannels = channelsByProfile.get(selected.name)!
      voiceInput?.cancel(); voiceInput = null
      voiceOutput?.cancel(); voiceOutput = null
      removeRuntimePeer(sessionRuntime.session_id, ws)
      session = createSession(connectionProfile.name, userId)
      sessionRuntime = sessionRuntimes.getOrCreate(session.id, userId)
      addRuntimePeer(session.id, ws)
      controllerId = randomUUID(); controllerLease = sessionRuntime.claim(controllerId).lease; observerOnly = false; activeMissionId = undefined; missionEvidence = []
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
      bulletin = new Bulletin()
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
      // Journal wire events before delivery, except recovery snapshots.
      // A runtime snapshot already contains the event tail; journaling it
      // would recursively embed prior snapshots and grow persisted state on
      // every attach/reconnect.
      if (msg.type !== 'runtime') sessionRuntime.emit(msg.type, msg)
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
      if (msg.type !== 'runtime') {
        const runtime = sessionRuntime.state
        for (const peer of runtimePeers.get(sessionRuntime.session_id) ?? []) {
          if (peer === ws || peer.readyState !== peer.OPEN) continue
          peer.send(JSON.stringify({ type: 'runtime', snapshot: { ...runtime, controller: runtime.controller ? { id: runtime.controller.id, expires_at: runtime.controller.expires_at } : undefined, gap: false } } satisfies ServerMessage))
        }
      }
    }

    const missionStore = () => new MissionStore(userId)
    const missionWire = (mission: Awaited<ReturnType<MissionStore['get']>>) => mission ? ({ id: mission.id, status: mission.status, revision: mission.revision, outcome: mission.outcome, criteria: mission.criteria.map(item => ({ id: item.id, description: item.description, state: item.state })) }) : null
    const challengeWire = (challenge: ReturnType<ChallengeDesk['get']>) => ({ id: challenge.id, mission_id: challenge.mission_id, ...(challenge.criterion_id ? { criterion_id: challenge.criterion_id } : {}), challenger: challenge.challenger, question: challenge.question, state: challenge.state, round: challenge.round, cost_usd: challenge.cost_usd, evidence_count: challenge.evidence.length, resolution_evidence_count: challenge.resolution_evidence?.length ?? 0 })
    const sendMission = (missionId: string, receipts = false): void => { const mission = missionStore().get(missionId); if (mission) send({ type: 'mission', mission: missionWire(mission)!, ...(receipts ? { receipts: missionStore().receipts(missionId) } : {}) }) }
    const finishMission = (execution: 'finished' | 'failed' | 'cancelled'): void => {
      if (!activeMissionId) return
      const store = missionStore(); const mission = store.get(activeMissionId); if (!mission) return
      try {
        const receipt = finalizeMission(mission, execution, missionEvidence, [], session.usage.cost_usd, [])
        store.saveReceipt(receipt)
        const next = {
          ...mission,
          revision: mission.revision + 1,
          criteria: mission.criteria.map(criterion => evaluateCriterion(criterion, missionEvidence)),
          status: receipt.accepted ? 'accepted' as const : execution === 'failed' ? 'failed' as const : 'needs_human' as const,
          updated_at: new Date().toISOString(),
        }
        store.save(next)
        send({ type: 'receipt', receipt }); sendMission(next.id, true)
      } catch (error: any) { send({ type: 'notice', level: 'error', message: 'mission receipt failed', detail: error.message }) }
    }

    const sendSessionReady = () => {
      const budget = connectionProfile.triggers?.budget
      const providerStatus = connectionProfile.model.auth === 'codex_oauth'
        ? (() => {
            try { return { auth: 'codex_oauth' as const, status: codexAuthStatus().status } }
            catch { return { auth: 'codex_oauth' as const, status: 'error' as const } }
          })()
        : { auth: 'api_key' as const, status: 'active' as const }
      send({
        type: 'session_ready', sessionId: session.id, profile: connectionProfile.name,
        model: connectionProfile.model.id, working_dir: connectionProfile.working_dir,
        effort: connectionEffort,
        allowed_packages: connectionProfile.executor?.allowed_packages ?? [],
        ...(budget ? { budget: { max_cost_usd: budget.max_cost_usd } } : {}),
        yolo: isYoloEnabled(approvalMode), protocol_version: protocolVersion, provider_status: providerStatus,
        capabilities: { runtime_recovery: true, correlated_decisions: true, model_effort_selection: true },
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
        onEvidence: (id, name, input, result, ok, provenance) => { if (!activeMissionId) return; missionEvidence.push(evidenceRef({ kind: 'tool_result', source: { user: userId, session: session.id, run: runId, tool_call: id }, content: result, provenance, ok })); void name; void input },
        onToolPrompt: (id, name, input, risk, reason, agentId) => requestToolApproval(sendForRun, id, name, input, risk, reason, agentId),
        onInputRequest: (id, prompt, kind, options, agentId) => requestInput(runId, prompt, kind, options, id, agentId),
        onSessionEnd: () => {},
        onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId, usage) => sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, usage: usageMetadata(agentId ? usage : usage ?? session.usage), context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) }),
        onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
        onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
        onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools, usage) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools, usage: usageMetadata(usage) }),
        onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
        onAgentMessage: post => { if (protocolVersion >= 4) sendForRun({ type: 'agent_message', post: { ...post, body_preview: post.body.slice(0, 240) } }) },
      }
    }

    // Explicit maintenance actions run in their own bounded invocation. A
    // completed turn's context may carry a dead signal or exhausted budget.
    const maintenanceContext = (): ToolContext => {
      const runId = randomRunId()
      if (!activeContext && abortController.signal.aborted) abortController = new AbortController()
      const operationController = new AbortController()
      maintenanceControllers.add(operationController)
      const context: ToolContext = {
        profile: connectionProfile,
        session,
        workingDir: connectionProfile.working_dir,
        memory,
        skills,
        mcpEntries,
        events: fleetEvents(runId),
        openai: connectionOpenai,
        provider: connectionRawProvider,
        signal: AbortSignal.any([abortController.signal, operationController.signal]),
        deadline: Date.now() + (connectionProfile.model.auth === 'codex_oauth'
          ? connectionProfile.model.codex.request_timeout_ms
          : 600_000),
        delegateDepth: 0,
        agentTools: connectionAgentTools,
        maxDepth: connectionProfile.max_depth ?? 2,
        wasmSupported,
        approvalMode,
        channels: connectionChannels,
        runId,
        pendingInputs: pendingStore,
        agentFrame: createRootFrame(connectionProfile.name, session.id),
        protocolVersion,
        agentControllers,
        bulletin,
      }
      context.provider = bindRunProvider(connectionRawProvider, context)
      maintenanceControllerByContext.set(context, operationController)
      return context
    }

    const releaseMaintenanceContext = (context: ToolContext): void => {
      const controller = maintenanceControllerByContext.get(context)
      if (!controller) return
      maintenanceControllerByContext.delete(context)
      maintenanceControllers.delete(controller)
      flushConnectionUsage()
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
        onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId, usage) => sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, usage: usageMetadata(agentId ? usage : usage ?? previewSession.usage), context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) }),
        onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
        onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
        onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools, usage) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools, usage: usageMetadata(usage) }),
        onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
        onInputRequest: (id, prompt, kind, options, agentId) => requestInput(runId, prompt, kind, options, id, agentId),
        onTodosUpdate: (todos, agentId) => sendForRun({ type: 'todos', todos, ...(agentId ? { agent_id: agentId } : {}) }),
        onStage: (stage, intensity, tier, model, state, cost_usd, agentId) => sendForRun({ type: 'stage', stage, intensity, tier, model, state, cost_usd, ...(agentId ? { agent_id: agentId } : {}) }),
      }
      try {
        const agentTools = await loadAgentTools(connectionProfile)
        const previewContext: ToolContext = {
          profile: connectionProfile, session: previewSession, workingDir: connectionProfile.working_dir, memory: previewMemory, skills, mcpEntries,
          events: planEvents, openai: connectionOpenai, provider: connectionProvider, signal: abortController.signal, delegateDepth: 0, agentTools,
          maxDepth: connectionProfile.max_depth ?? 2, wasmSupported, approvalMode, channels: connectionChannels, runId,
          pendingInputs: pendingStore,
          agentFrame: createRootFrame(connectionProfile.name, previewSession.id),
          protocolVersion,
          agentControllers,
        }
        previewContext.provider = bindRunProvider(connectionRawProvider, previewContext)
        const previewUsageBefore = { ...previewSession.usage }
        let preview!: Awaited<ReturnType<typeof runPlanPreview>>
        try {
          preview = await runPlanPreview(request, connectionProfile, previewSession, previewContext, planEvents, connectionOpenai, abortController.signal)
        } finally {
          // Preview uses a cloned session. Carry only its inference delta into
          // the live session, including cancellation and provider failures.
          mergeUsageDelta(session.usage, usageDeltaFromSession(previewUsageBefore, previewSession.usage))
        }
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
      if (entry.prompt_field && promptValue !== undefined && input[entry.prompt_field] === undefined) {
        input[entry.prompt_field] = promptValue
        if (entry.prompt_field !== 'prompt') delete input.prompt
        if (entry.prompt_field !== 'text') delete input.text
      }

      const parentContext = activeContext
      const parentBudget = parentContext?.budget ?? operatorBudget
      const requestedBudget = msg.budget_usd ?? entry.budget_usd
      const implicitShare = parentBudget ? parentBudget.remainingCost() / count : undefined
      if (msg.budget_usd !== undefined && (!Number.isFinite(msg.budget_usd) || msg.budget_usd < 0)) {
        send({ type: 'notice', level: 'warn', message: 'spawn refused: invalid budget', detail: 'budget_usd must be a finite non-negative number' })
        return
      }
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
            events: fleetEvents(runId), openai: connectionOpenai, provider: connectionRawProvider, signal: abortController.signal, delegateDepth: 0,
            agentTools: connectionAgentTools, maxDepth: connectionProfile.max_depth ?? 2, wasmSupported, approvalMode,
            channels: connectionChannels, runId, pendingInputs: pendingStore, budget: operatorBudget,
            agentFrame: createRootFrame(connectionProfile.name, session.id), protocolVersion,
            agentOrigin: 'operator', agentControllers, bulletin,
          }
      if (!parentContext) context.provider = bindRunProvider(connectionRawProvider, context)
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
              if (childBudget && parentBudget) parentBudget.absorbChildUsage(childBudget, 0)
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
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof (msg as any).type !== 'string') {
        send({ type: 'error', message: 'Invalid message' })
        return
      }
      const correlatedType = msg.type === 'attach' || msg.type === 'runtime_subscribe'
      const rawRequestId = (msg as any).request_id
      const correlation = correlatedType && rawRequestId !== undefined
        ? (typeof rawRequestId === 'string' && rawRequestId.length > 0 && rawRequestId.length <= 256 ? { request_id: rawRequestId } : null)
        : {}
      if (correlation === null) { send({ type: 'error', message: 'invalid request id' }); return }
      const decisionCorrelation = typeof rawRequestId === 'string' && rawRequestId.length > 0 && rawRequestId.length <= 256 ? { request_id: rawRequestId } : {}

      const mutatingMessages = new Set(['message', 'plan_request', 'cancel', 'tool_approve', 'tool_deny', 'input_response', 'code_result', 'ui_result', 'set_profile', 'set_model', 'set_approval_mode', 'skill_save', 'skill_promote', 'skill_discard', 'skills_mine', 'compact', 'pending_answer', 'undo_apply', 'spawn', 'agent_cancel', 'project_create', 'project_assign', 'board_post', 'mission_create', 'mission_human', 'challenge_open', 'challenge_answer'])
      if (observerOnly && mutatingMessages.has(msg.type)) { send({ type: 'error', message: 'observer connection cannot mutate session; claim control first', ...decisionCorrelation }); return }
      if (mutatingMessages.has(msg.type) && controllerLease) {
        try { sessionRuntime.assertController(controllerId, controllerLease) }
        catch { send({ type: 'error', message: 'stale or invalid controller lease', ...decisionCorrelation }); return }
      }

      if (msg.type === 'hello') {
		const requestedProtocolVersion = msg.protocol_version ?? 1
		if (requestedProtocolVersion !== 2 && requestedProtocolVersion !== 3 && requestedProtocolVersion !== PROTOCOL_VERSION) {
		  send({ type: 'error', message: `Unsupported protocol version ${requestedProtocolVersion}; client must use version 2, 3, or ${PROTOCOL_VERSION}.` })
		  return
		}
		protocolVersion = requestedProtocolVersion
        // Only honour hello before the session has any messages
        if (session.messages.length === 0) {
          if (msg.user_id !== undefined && (typeof msg.user_id !== 'string' || msg.user_id.length === 0 || msg.user_id.length > 256)) {
            send({ type: 'error', message: 'invalid user scope' }); return
          }
          if (msg.user_id !== undefined) userId = sanitizeUserId(msg.user_id)
          challengeDesk = new ChallengeDesk(3, 1, join(userPaths(userId, '').missionsDir, 'challenges.json'))
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

      if (msg.type === 'attach') {
        try {
          if (typeof msg.session_id !== 'string' || msg.session_id.length === 0 || (msg.mode !== 'observe' && msg.mode !== 'control')) { send({ type: 'error', message: 'invalid attach scope', ...correlation }); return }
          const target = sessionRuntimes.get(msg.session_id, userId)
          if (!target) { send({ type: 'error', message: 'session not found or belongs to another user', ...correlation }); return }
          // Execution callbacks and profile/session state are connection
          // owned. Until a full session handoff exists, fail closed instead
          // of letting control messages target an attached runtime while
          // continuing to mutate the original session.
          if (msg.mode === 'control' && target.session_id !== session.id) {
            send({ type: 'error', message: 'control attach requires a new session connection', ...correlation }); return
          }
          removeRuntimePeer(sessionRuntime.session_id, ws)
          if (controllerLease) {
            try { sessionRuntime.release(controllerId, controllerLease) } catch { /* expired or already transferred */ }
          }
          if (msg.mode === 'control') {
            const claimed = target.claim(controllerId)
            controllerLease = claimed.lease; observerOnly = false
          } else { controllerLease = undefined; observerOnly = true }
          sessionRuntime = target
          addRuntimePeer(sessionRuntime.session_id, ws)
          const sub = target.subscribe(0)
          send({ type: 'runtime', snapshot: { ...sub.snapshot, controller: sub.snapshot.controller ? { id: sub.snapshot.controller.id, expires_at: sub.snapshot.controller.expires_at } : undefined, gap: sub.gap }, ...correlation })
        } catch (error: any) { send({ type: 'error', message: error.message, ...correlation }) }
        return
      }

      if (msg.type === 'runtime_subscribe') {
        if (typeof msg.session_id !== 'string' || msg.session_id.length === 0 || (msg.after_seq !== undefined && (!Number.isInteger(msg.after_seq) || msg.after_seq < 0))) { send({ type: 'error', message: 'invalid runtime cursor', ...correlation }); return }
        const target = sessionRuntimes.get(msg.session_id, userId)
        if (!target) { send({ type: 'error', message: 'session not found or belongs to another user', ...correlation }); return }
        const sub = target.subscribe(msg.after_seq ?? 0)
        send({ type: 'runtime', snapshot: { ...sub.snapshot, controller: sub.snapshot.controller ? { id: sub.snapshot.controller.id, expires_at: sub.snapshot.controller.expires_at } : undefined, gap: sub.gap }, ...correlation })
        return
      }

      if (msg.type === 'mission_list') {
        for (const mission of missionStore().list()) send({ type: 'mission', mission: missionWire(mission)!, receipts: missionStore().receipts(mission.id) })
        return
      }
      if (msg.type === 'mission_create') {
        try {
          const mission = createMission({ user: userId, profile: connectionProfile.name, project: session.project, session_id: session.id, outcome: msg.outcome, constraints: msg.constraints ?? [], criteria: msg.criteria as any })
          missionStore().save(mission); activeMissionId = mission.id; missionEvidence = []; send({ type: 'mission', mission: missionWire(mission)! })
        } catch (error: any) { send({ type: 'error', message: error.message }) }
        return
      }
      if (msg.type === 'mission_human') {
        try {
          const store = missionStore(); const mission = store.get(msg.mission_id); if (!mission) throw new Error('mission not found')
          const updated = completeHumanCriterion(mission, msg.criterion_id, userId, msg.revision); store.save(updated); send({ type: 'mission', mission: missionWire(updated)!, receipts: store.receipts(updated.id) })
        } catch (error: any) { send({ type: 'error', message: error.message }) }
        return
      }
      if (msg.type === 'challenge_list') {
        for (const challenge of challengeDesk.list(msg.mission_id)) send({ type: 'challenge', challenge: challengeWire(challenge) })
        return
      }
      if (msg.type === 'challenge_open') {
        try {
          const mission = missionStore().get(msg.mission_id); if (!mission) throw new Error('mission not found')
          const challenge = challengeDesk.open({ missionId: mission.id, criterionId: msg.criterion_id, challenger: userId, question: msg.question }); send({ type: 'challenge', challenge: challengeWire(challenge) })
        } catch (error: any) { send({ type: 'error', message: error.message }) }
        return
      }
      if (msg.type === 'challenge_answer') {
        try {
          const challenge = challengeDesk.get(msg.challenge_id)
          const answer = challengeDesk.answer(challenge.id, { by: userId, unresolved: msg.unresolved, note: msg.note, evidence: msg.unresolved ? undefined : missionEvidence })
          send({ type: 'challenge', challenge: challengeWire(answer) })
          // Required challenges are part of mission acceptance. Persist an
          // unresolved answer immediately so reconnecting Studio clients see
          // the human gate, even when no active execution is attached.
          if (answer.state === 'unresolved') {
            const store = missionStore()
            const mission = store.get(answer.mission_id)
            if (mission && mission.status !== 'needs_human' && mission.status !== 'accepted') {
              store.save({ ...mission, revision: mission.revision + 1, status: 'needs_human', updated_at: new Date().toISOString() })
              sendMission(mission.id, true)
            } else if (mission) sendMission(mission.id, true)
          } else {
            sendMission(answer.mission_id, true)
          }
        } catch (error: any) { send({ type: 'error', message: error.message }) }
        return
      }

      if (msg.type === 'set_profile') {
        if (activeContext || pendingApprovals.size > 0 || maintenanceControllers.size > 0) {
          send({ type: 'notice', level: 'warn', message: 'profile change refused while a turn is active', detail: 'cancel and wait for the current turn to finish first' })
          return
        }
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
        const executePendingAnswer = async () => {
          const pending = pendingStore.get(msg.pending_id)
          if (!pending) throw new Error('This request has expired or was already answered.')
          const resumedRunId = pending.run_id
          const sendForRun = makeRunEmitter(resumedRunId, send)
          const result = await resumePendingInput(msg.pending_id, msg.value, 'ws', {
            pendingStore, runStore, abortRegistry,
            resolveProfile: name => profiles.get(name) ?? null,
            channels: connectionChannels,
            protocolVersion,
            onAccepted: () => sendForRun({ type: 'turn_start' }),
            events: {
              onToken: (t, agentId) => sendForRun({ type: 'token', content: t, ...(agentId ? { agent_id: agentId } : {}) }),
              onToolStart: (id, n, i, agentId) => sendForRun({ type: 'tool_start', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
              onToolEnd: (id, n, r, ok, agentId) => sendForRun({ type: 'tool_end', id, name: n, result: r, ok, ...(agentId ? { agent_id: agentId } : {}) }),
              onToolParked: (id, n, i, agentId) => sendForRun({ type: 'tool_parked', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
              onToolPrompt: (id, n, i, risk, reason, agentId) => requestToolApproval(sendForRun, id, n, i, risk, reason, agentId),
              onSessionEnd: id => sendForRun({ type: 'session_end', sessionId: id }),
              onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId, usage) => sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, usage: usageMetadata(agentId ? usage : usage ?? session.usage), context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) }),
              onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
              onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
              onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools, usage) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools, usage: usageMetadata(usage) }),
              onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
              onInputRequest: (id, prompt, kind, options, agentId) => requestInput(resumedRunId, prompt, kind, options, id, agentId),
            },
          })
          if (result.status === 'failed' || result.status === 'ignored') {
            sendForRun({ type: 'error', message: result.status === 'failed' ? result.error : result.reason, ...(msg.request_id ? { request_id: msg.request_id } : {}) })
          }
          send({ type: 'pending_result', pending_id: msg.pending_id, status: result.status === 'completed' || result.status === 'waiting_input' ? 'answered' : result.status, ...(result.status === 'failed' || result.status === 'ignored' ? { error: result.status === 'failed' ? result.error : result.reason } : {}), ...(msg.request_id ? { request_id: msg.request_id } : {}) })
          if (result.status !== 'ignored') sessionRuntime.emit('pending_answer', { id: msg.pending_id, run_id: resumedRunId })
          sendPending()
          return result
        }
        try {
          const result = await runCorrelatedDecision(msg.pending_id, msg.request_id, executePendingAnswer)
          if (msg.request_id && result.status !== 'ignored') send({ type: 'notice', level: 'info', message: 'pending answer accepted', request_id: msg.request_id })
        } catch (error: any) {
          send({ type: 'error', message: error.message, ...(msg.request_id ? { request_id: msg.request_id } : {}) })
        }
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
        const selectedProfile = baseProfile
        const request = ++modelCatalogRequest
        const discoveryGeneration = activeProfile.model.auth === 'codex_oauth' ? currentCodexGeneration() : undefined
        const notices: string[] = []
        let models
        try {
          models = await discoverProfileModels(activeProfile, { report: message => notices.push(message) })
        } catch {
          models = listModels(activeProfile)
          notices.push('Model discovery unavailable: showing bundled models.')
        }
        const currentGeneration = activeProfile.model.auth === 'codex_oauth' ? currentCodexGeneration() : undefined
        if (baseProfile !== selectedProfile || request !== modelCatalogRequest || ws.readyState !== WebSocket.OPEN) return
        if (discoveryGeneration !== currentGeneration) {
          send({ type: 'notice', level: 'warn', message: 'model catalog changed while discovery was pending', detail: 'refresh model metadata before selecting an effort' })
          return
        }
        connectionModels = models
        modelCatalogGeneration = currentGeneration
        connectionEffortCapability = models.find(model => model.id === connectionModel)?.effort
        if (connectionEffortCapability?.status === 'supported' && connectionEffort !== null) rebuildConnectionProfile()
        for (const message of notices.filter(message => /unavailable|No API key/.test(message))) send({ type: 'notice', level: 'warn', message })
        send({ type: 'models', models, current: connectionModel, effort: connectionEffort })
        return
      }

      if (msg.type === 'profiles_list') {
        const available = [...profiles.values()].map(item => ({ name: item.name, description: item.description, mode: item.mode }))
          .sort((a, b) => a.name.localeCompare(b.name))
        send({ type: 'profiles', profiles: available, current: connectionProfile.name })
        return
      }

      if (msg.type === 'set_model') {
        const rawModelRequestId = (msg as any).request_id
        if (rawModelRequestId !== undefined && (typeof rawModelRequestId !== 'string' || rawModelRequestId.length === 0 || rawModelRequestId.length > 256)) {
          send({ type: 'error', message: 'invalid request id' })
          return
        }
        const modelCorrelation = rawModelRequestId === undefined ? {} : { request_id: rawModelRequestId }
        const rawModel = (msg as any).model
        if (typeof rawModel !== 'string' || rawModel.length === 0 || rawModel.length > 256) {
          send({ type: 'notice', level: 'error', message: 'model change refused', detail: 'model must be a non-empty string of at most 256 characters', ...modelCorrelation })
          return
        }
        const rawEffort = (msg as any).effort
        if (rawEffort !== undefined && rawEffort !== null && (typeof rawEffort !== 'string' || rawEffort.length === 0 || rawEffort.length > 64)) {
          send({ type: 'notice', level: 'error', message: 'model effort change refused', detail: 'effort must be null or a string of at most 64 characters', ...modelCorrelation })
          return
        }
        if (activeContext || pendingApprovals.size > 0 || maintenanceControllers.size > 0) {
          send({ type: 'notice', level: 'warn', message: 'model change refused while a turn is active', detail: 'cancel and wait for the current turn to finish first', ...modelCorrelation })
          return
        }
        const selectionRequest = ++modelSelectionRequest
        let candidate = connectionModels.find(model => model.id === msg.model) ?? listModels(baseProfile).find(model => model.id === msg.model)
        if (candidate?.effort?.source === 'live' && modelCatalogGeneration !== currentCodexGeneration()) candidate = undefined
        if (!candidate && connectionProfile.model.auth === 'codex_oauth') {
          const selectedProfile = baseProfile
          const discoveryGeneration = currentCodexGeneration()
          try {
            const models = await discoverProfileModels(baseProfile)
            const currentGeneration = currentCodexGeneration()
            if (baseProfile !== selectedProfile || ws.readyState !== WebSocket.OPEN || discoveryGeneration !== currentGeneration) {
              send({ type: 'notice', level: 'warn', message: 'model catalog changed while discovery was pending', detail: 'refresh model metadata before selecting an effort', ...modelCorrelation })
              return
            }
            if (selectionRequest !== modelSelectionRequest) {
              send({ type: 'notice', level: 'warn', message: 'model change superseded', ...modelCorrelation })
              return
            }
            if (activeContext || pendingApprovals.size > 0 || maintenanceControllers.size > 0) {
              send({ type: 'notice', level: 'warn', message: 'model change refused while a turn is active', ...modelCorrelation })
              return
            }
            connectionModels = models
            modelCatalogGeneration = currentGeneration
            candidate = models.find(model => model.id === msg.model)
          } catch { /* retain the existing unavailable-model response */ }
        }
        if (selectionRequest !== modelSelectionRequest) {
          send({ type: 'notice', level: 'warn', message: 'model change superseded', ...modelCorrelation })
          return
        }
        if (candidate && !candidate.available) {
          send({ type: 'notice', level: 'error', message: `model ${msg.model} requires another provider`, detail: candidate.reason, ...modelCorrelation })
          return
        }
        if (!candidate) candidate = { id: msg.model, label: msg.model, provider: connectionProfile.model.auth === 'codex_oauth' ? 'OpenAI Codex' : 'custom provider', base_url: connectionProfile.model.auth === 'codex_oauth' ? '' : connectionProfile.model.base_url, context_window: 0, input_price: 0, output_price: 0, tags: ['unknown'], available: true, effort: { status: 'unknown', options: [], source: 'live', checked_at: new Date().toISOString(), stale: false } }
        const requestedEffort = msg.effort === undefined ? (msg.model === connectionModel ? connectionEffort : null) : msg.effort
        const effortResult = validateModelEffort(candidate, requestedEffort)
        if (!effortResult.ok) {
          send({ type: 'notice', level: 'error', message: 'model effort change refused', detail: effortResult.reason, ...modelCorrelation })
          return
        }
        connectionModel = msg.model
        connectionEffort = effortResult.effort
        connectionEffortCapability = candidate.effort
        rebuildConnectionProfile()
        send({ type: 'model_changed', model: connectionModel, effort: connectionEffort, ...modelCorrelation })
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
          const helper = activeContext ?? maintenanceContext()
          const improver = new DefaultImprover(connectionProfile, connectionOpenai, helper.provider)
          try {
            await improver.mineSkills([session])
          } finally {
            releaseMaintenanceContext(helper)
          }
          sendSkills()
        } catch (error: any) {
          send({ type: 'notice', level: 'error', message: 'skills mining failed', detail: error.message })
        } finally {
          miningSkills = false
        }
        return
      }

      if (msg.type === 'compact') {
        const helper = activeContext ?? maintenanceContext()
        const providerForProjection = helper.provider
        try {
          const before = estimateTokens(await project(session, connectionProfile, connectionOpenai, memory, undefined, providerForProjection))
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
          const afterProjection = await project(session, compactProfile, connectionOpenai, memory, undefined, providerForProjection)
          const after = estimateTokens(afterProjection, session)
          saveSession(session)
          send({ type: 'stats', tokens_in: session.usage.input, tokens_out: session.usage.output, cost_usd: session.usage.cost_usd, usage: usageMetadata(session.usage), context_window: contextWindowFor(connectionProfile), context_tokens: after })
          send({ type: 'notice', level: 'info', message: before > after ? `compacted context · ${before - after} tokens saved` : 'context already compact', detail: before > after ? `${before} → ${after} tokens` : 'no condensation needed' })
        } finally {
          releaseMaintenanceContext(helper)
        }
        return
      }

      if (msg.type === 'cancel') {
        abortController.abort()
        for (const controller of maintenanceControllers) controller.abort()
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
        if (typeof msg.id !== 'string' || msg.id.length === 0 || msg.id.length > 256) { send({ type: 'error', message: 'invalid decision id' }); return }
        try {
          runCorrelatedDecision(msg.id, msg.request_id, () => {
            const pending = pendingApprovals.get(msg.id)
            if (!pending) throw new Error('stale or unknown decision id')
            if (msg.type === 'tool_approve' && msg.remember) sessionApprovalGrants.remember(pending.name, 'prompt')
            pending.resolve(msg.type === 'tool_approve')
            pendingApprovals.delete(msg.id)
            sessionRuntime.emit(msg.type, { id: msg.id })
            return true
          })
          if (msg.request_id) send({ type: 'notice', level: 'info', message: 'decision accepted', request_id: msg.request_id })
        } catch (error: any) { send({ type: 'error', message: error.message, ...(msg.request_id ? { request_id: msg.request_id } : {}) }) }
        return
      }

      if (msg.type === 'input_response') {
        if (typeof msg.id !== 'string' || msg.id.length === 0 || msg.id.length > 256) { send({ type: 'error', message: 'invalid response id' }); return }
        if (typeof msg.value !== 'string') { send({ type: 'error', message: 'invalid response value' }); return }
        try {
          runCorrelatedDecision(msg.id, msg.request_id, () => {
            const cb = pendingInputRequests.get(msg.id)
            if (!cb) throw new Error('stale or unknown response id')
            cb(msg.value); pendingInputRequests.delete(msg.id); sessionRuntime.emit(msg.type, { id: msg.id })
            return true
          })
          if (msg.request_id) send({ type: 'notice', level: 'info', message: 'response accepted', request_id: msg.request_id })
        } catch (error: any) { send({ type: 'error', message: error.message, ...(msg.request_id ? { request_id: msg.request_id } : {}) }) }
        return
      }

      if (msg.type === 'code_result') {
        if (typeof msg.id !== 'string' || msg.id.length === 0 || msg.id.length > 256) { send({ type: 'error', message: 'invalid result id' }); return }
        try {
          runCorrelatedDecision(msg.id, msg.request_id, () => {
            const cb = pendingCodeExecutions.get(msg.id)
            if (!cb) throw new Error('stale or unknown result id')
            cb({ id: msg.id, stdout: msg.stdout, stderr: msg.stderr, exit_code: msg.exit_code, files: msg.files, duration_ms: 0 })
            pendingCodeExecutions.delete(msg.id)
            sessionRuntime.emit(msg.type, { id: msg.id })
            return true
          })
          if (msg.request_id) send({ type: 'notice', level: 'info', message: 'result accepted', request_id: msg.request_id })
        } catch (error: any) { send({ type: 'error', message: error.message, ...(msg.request_id ? { request_id: msg.request_id } : {}) }) }
        return
      }

      if (msg.type === 'ui_result') {
        if (typeof msg.id !== 'string' || msg.id.length === 0 || msg.id.length > 256) { send({ type: 'error', message: 'invalid result id' }); return }
        try {
          runCorrelatedDecision(msg.id, msg.request_id, () => {
            const cb = pendingRenders.get(msg.id)
            if (!cb) throw new Error('stale or unknown result id')
            cb({
              id: msg.id,
              ok: msg.ok !== false,
              errors: Array.isArray(msg.errors) ? msg.errors.slice(0, 20).map(String) : [],
              stdout: typeof msg.stdout === 'string' ? msg.stdout.slice(0, 8000) : undefined,
              duration_ms: Number(msg.duration_ms) || 0,
              bytes: Number(msg.bytes) || 0,
            })
            pendingRenders.delete(msg.id)
            sessionRuntime.emit(msg.type, { id: msg.id })
            return true
          })
          if (msg.request_id) send({ type: 'notice', level: 'info', message: 'result accepted', request_id: msg.request_id })
        } catch (error: any) { send({ type: 'error', message: error.message, ...(msg.request_id ? { request_id: msg.request_id } : {}) }) }
        return
      }

      if (msg.type === 'plan_request') {
        await handlePlanRequest(msg.content)
        return
      }

      if (msg.type === 'resume') {
        modelSelectionRequest += 1
        const loaded = loadSession(userId, msg.sessionId)
        if (loaded) {
          flushConnectionUsage()
          session = loaded
          sessionRuntime = sessionRuntimes.getOrCreate(session.id, userId)
          addRuntimePeer(session.id, ws)
          controllerId = randomUUID(); controllerLease = sessionRuntime.claim(controllerId).lease; observerOnly = false
          baseProfile = profiles.get(loaded.profile) ?? baseProfile
          connectionProfile = baseProfile
          connectionModel = connectionProfile.model.id
          connectionEffort = connectionProfile.model.reasoning_effort ?? (connectionProfile.model.auth === 'codex_oauth' ? connectionProfile.model.codex.reasoning_effort ?? null : null)
          connectionEffortCapability = listModels(connectionProfile).find(model => model.id === connectionModel)?.effort
          modelCatalogGeneration = connectionProfile.model.auth === 'codex_oauth' ? currentCodexGeneration() : undefined
          connectionProvider = createProvider(connectionProfile, { effortCapability: connectionEffortCapability })
          connectionRawProvider = connectionProvider
          connectionOpenai = connectionProfile.model.auth === 'codex_oauth' ? undefined : createProviderClient(connectionProfile)
          connectionImprover = new DefaultImprover(connectionProfile, connectionOpenai, connectionProvider)
          connectionAgentTools = await loadAgentTools(connectionProfile)
          operatorBudget = connectionProfile.triggers?.budget ? new RunBudget(connectionProfile.triggers.budget) : undefined
          activeContext = undefined
          memory = connectionProfile.memory?.provider === 'graph'
            ? new GraphMemoryProvider(connectionProfile.artifact_dir, session)
            : new FsMemoryProvider(connectionProfile.artifact_dir, session)
          usageAtConnectionStart = { ...session.usage }
          // Resume can switch profiles (baseProfile above is re-resolved to the resumed
          // session's own profile), so report the post-resume profile, not whatever the
          // connection was on before this frame.
          send({ type: 'session_resumed', sessionId: session.id, profile: connectionProfile.name })
        } else {
          send({ type: 'error', message: `Session ${msg.sessionId} not found` })
        }
        return
      }

      const projectReply = handleProjectMessage(msg, userId)
      if (projectReply) { send(projectReply); return }

      if (msg.type === 'board_post') {
        try {
          const liveRecipients = new Set(['root', ...agentControllers.keys()])
          const turnKey = `root:${session.id}:${activeContext?.runId ?? session.messages.length}`
          postBoardMessage(msg, {
            bulletin,
            sessionId: session.id,
            profileName: connectionProfile.name,
            agentFrame: createRootFrame(connectionProfile.name, session.id),
            recipientAgentIds: liveRecipients,
            turnKey,
            taintSources: session.taint_sources,
            onAgentMessage: post => {
              if (protocolVersion >= 4) send({ type: 'agent_message', post: { ...post, body_preview: post.body.slice(0, 240) } })
            },
          })
        } catch (error: any) {
          send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
        }
        return
      }

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
        const runJournal: RunJournal = newJournal({ user: userId, session_id: session.id, profile: connectionProfile.name, config_fingerprint: hashArguments({ profile: connectionProfile.name, model: connectionModel, approval: approvalMode }), mode: 'live-branch' })
        const replayStore = new ReplayStore(userId)
        const effects = new Map<string, EffectReceipt>()
        const persistJournal = (): void => { try { replayStore.save(runJournal) } catch (error: any) { console.warn(`[replay] journal save failed: ${error.message}`) } }
        recordEvent(runJournal, 'result', { input: msg.content }, 'turn_start'); markCheckpoint(runJournal, 'turn_start'); persistJournal()
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
          onToken: (t, agentId) => { recordEvent(runJournal, 'token', t); persistJournal(); sendForRun({ type: 'token', content: t, ...(agentId ? { agent_id: agentId } : {}) }); voiceOutput?.push(t) },
          onToolStart: (id, n, i, agentId) => { recordEvent(runJournal, 'tool_start', i, n); effects.set(id, recordEffect(runJournal, { tool: n, argument_hash: hashArguments(i), state: 'started' })); persistJournal(); sendForRun({ type: 'tool_start', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }) },
          onToolEnd: (id, n, r, ok, agentId) => { recordEvent(runJournal, 'tool_end', { result: r, ok }, n); const effect = effects.get(id); if (effect) { effect.state = ok ? 'completed' : 'failed'; effect.completed_at = new Date().toISOString(); effect.result_hash = hashArguments(r) }; persistJournal(); sendForRun({ type: 'tool_end', id, name: n, result: r, ok, ...(agentId ? { agent_id: agentId } : {}) }) },
          onEvidence: (id, name, input, result, ok, provenance, source) => { recordEvent(runJournal, 'result', { tool_call_id: id, ok, provenance, source }, name); persistJournal(); if (!activeMissionId) return; missionEvidence.push(evidenceRef({ kind: 'tool_result', source: { user: userId, session: session.id, run: runId, tool_call: id }, content: result, provenance, ok })); void input },
          onToolParked: (id, n, i, agentId) => sendForRun({ type: 'tool_parked', id, name: n, input: i, ...(agentId ? { agent_id: agentId } : {}) }),
          onToolPrompt: (id, n, i, risk, reason, agentId) => requestToolApproval(sendForRun, id, n, i, risk, reason, agentId),
          onSessionEnd: (id) => {
            voiceOutput?.end()
            saveSession(session)
            const status = runSignal.aborted ? 'cancelled' : terminalStatus
            recordEvent(runJournal, 'result', { status }, 'session_end'); markCheckpoint(runJournal, 'session_end'); persistJournal()
            sessionRuntime.setStatus(status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed')
            sendForRun({ type: 'session_end', sessionId: id, status, ...(terminalReason ? { reason: terminalReason } : {}) })
            finishMission(status === 'completed' ? 'finished' : status === 'cancelled' ? 'cancelled' : 'failed')
            closeMcpWhenIdle()
          },
          onStats: (tokens_in, tokens_out, cost_usd, context_tokens, agentId, usage) => {
            sendForRun({ type: 'stats', tokens_in, tokens_out, cost_usd, usage: usageMetadata(agentId ? usage : usage ?? session.usage), context_window: contextWindowFor(connectionProfile), context_tokens, ...(agentId ? { agent_id: agentId } : {}) })
          },
          onAgentSpawn: (frame, input, budget) => sendForRun({ type: 'agent_spawn', frame, input, ...(budget ? { budget } : {}) }),
          onAgentState: (agentId, state, tool) => sendForRun({ type: 'agent_state', agent_id: agentId, state, ...(tool ? { tool } : {}) }),
          onAgentStats: (agentId, tokens_in, tokens_out, cost_usd, tools, usage) => sendForRun({ type: 'agent_stats', agent_id: agentId, tokens_in, tokens_out, cost_usd, tools, usage: usageMetadata(usage) }),
          onAgentEnd: (agentId, status, error, output, durationMs = 0) => sendForRun({ type: 'agent_end', agent_id: agentId, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}), duration_ms: durationMs }),
          onAgentMessage: post => { if (protocolVersion >= 4) sendForRun({ type: 'agent_message', post: { ...post, body_preview: post.body.slice(0, 240) } }) },
          onSafetyNotice: (classifierModel) => {
            if (safetyDisclosed) return
            safetyDisclosed = true
            sendForRun({ type: 'notice', level: 'info', message: `ambiguous tools classified by ${classifierModel}`, detail: 'verdicts are cached · set safety.enabled: false or use /approval bash to opt out' })
          },
          onNotice: (level, message, detail, agentId) => sendForRun({ type: 'notice', level, message, detail, ...(agentId ? { agent_id: agentId } : {}) }),
          onArtifacts: (sessionId, artifacts, agentId) => {
            const surfaced = artifacts.map((artifact: any) => {
              const sourceTool = typeof artifact.source_tool_name === 'string' ? artifact.source_tool_name : typeof artifact.generating_tool === 'string' ? artifact.generating_tool : undefined
              const sourceCode = typeof artifact.source_code_id === 'string' ? artifact.source_code_id : typeof artifact.code_ref === 'string' ? artifact.code_ref : undefined
              const sourceSession = typeof artifact.source_session_id === 'string' ? artifact.source_session_id : sessionId
              const sourceCall = typeof artifact.source_tool_call_id === 'string' ? artifact.source_tool_call_id : undefined
              if (!sourceTool || !sourceCode || !sourceSession || !sourceCall) return { ...artifact, promotion: { state: 'blocked', reason: 'artifact source tool, code, session, and tool-call IDs required' } }
              try {
                const recipe = promoteArtifact(userId, { profile: connectionProfile.name, generatingTool: sourceTool, codeRef: sourceCode, parameters: artifact.parameters ?? {}, payload: artifact.data ?? artifact, sessionId: sourceSession, toolCallId: sourceCall, source: 'agent-loop' })
                new ArtifactStore(userId).save(recipe)
                return { ...artifact, recipe_id: recipe.id, version: recipe.last_good?.version, promotion: { state: 'promoted', provenance: recipe.provenance } }
              } catch (error: any) {
                return { ...artifact, promotion: { state: 'blocked', reason: error.message } }
              }
            })
            sendForRun({ type: 'artifacts', sessionId, artifacts: surfaced, ...(agentId ? { agent_id: agentId } : {}) })
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
          events, openai: connectionOpenai, provider: connectionRawProvider, signal: runSignal, delegateDepth: 0,
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
          bulletin,
        }
        context.provider = bindRunProvider(connectionRawProvider, context)
        activeContext = context

        try {
          await runInteractiveTurn(msg.content, connectionProfile, session, context, events, connectionOpenai, runSignal, msg.skipWorkflow)
          terminalStatus = runSignal.aborted ? 'cancelled' : 'completed'
          runStore.update(runId, { status: terminalStatus, session_id: session.id, finished_at: new Date().toISOString() })
          if (runSignal.aborted) {
            saveSession(session)
            recordEvent(runJournal, 'result', { status: terminalStatus }, 'session_end'); markCheckpoint(runJournal, 'session_end'); persistJournal()
            sessionRuntime.setStatus('cancelled')
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

          if (e.name !== 'AbortError' && terminalStatus !== 'completed') finishMission(terminalStatus === 'cancelled' ? 'cancelled' : 'failed')
          if (runSignal.aborted || e instanceof BudgetExceeded) {
		    saveSession(session)
		    recordEvent(runJournal, 'result', { status: terminalStatus, reason: terminalReason }, 'session_end'); markCheckpoint(runJournal, 'session_end'); persistJournal()
		    sessionRuntime.setStatus(terminalStatus === 'cancelled' ? 'cancelled' : terminalStatus === 'budget_exceeded' ? 'failed' : 'failed')
            sendForRun({ type: 'session_end', sessionId: session.id, status: terminalStatus, ...(terminalReason ? { reason: terminalReason } : {}) })
          }
        } finally {
          // Maintenance operations must never inherit a completed turn's
          // signal, deadline, or provider budget.
          if (activeContext === context) activeContext = undefined
          // A socket close may flush before the aborted provider finalizes its usage.
          // Flush the remaining delta after completion as well.
          flushConnectionUsage()
        }
      }
    })

    ws.on('close', () => {
      openSockets.delete(ws)
      abortController.abort()
      for (const controller of maintenanceControllers) controller.abort()
      maintenanceControllers.clear()
      // Disconnect relinquishes the controller lease so a reconnecting local
      // client can claim control immediately; runtime state stays server-owned.
      if (controllerLease) {
        try { sessionRuntime.release(controllerId, controllerLease) } catch { /* expired or already transferred */ }
        controllerLease = undefined
      }
      removeRuntimePeer(sessionRuntime.session_id, ws)
	  for (const pending of pendingApprovals.values()) pending.resolve(false)
	  pendingApprovals.clear()
      sessionApprovalGrants.clear()
	  for (const resolve of pendingInputRequests.values()) resolve('')
	  pendingInputRequests.clear()
      resolvePendingClientWork('Client disconnected before completion.')
      flushConnectionUsage()

      // Destroy per-connection MCP clients (fire-and-forget)
      if (mcpIdleTimer) clearTimeout(mcpIdleTimer)
      void destroyMcpClients(mcpEntries).catch(e => console.error('[mcp] destroy error:', e.message))

      // on_stop hooks (fire-and-forget — close handler cannot be async)
      void runHooks('on_stop', connectionProfile, { SESSION_ID: session.id, PROFILE: connectionProfile.name })
        .catch(e => console.error('[on_stop hook] error:', e.message))

      // Disconnect must not resurrect detached model work. Improvement runs
      // remain explicit actions while a connection is alive.
    })
    ws.on('error', (e) => console.error('ws error:', e.message))
  })

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    unregisterServer(PORT)
    clearInterval(runtimeCleanupTimer)
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
