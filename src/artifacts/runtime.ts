import { recordUsage } from '../usage/ledger.js'
import { createProviderClient } from '../provider/client.js'
import { createProvider } from '../provider/factory.js'
import { bindRunProvider } from '../provider/invocation.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { resolveAclDecisionWithMemory } from '../tools/acl.js'
import { effectFor, isGatedEffect } from '../tools/effects.js'
import { getAllTools } from '../tools/registry.js'
import type { AgentLoopEvents, Skill, ToolContext } from '../tools/types.js'
import { defaultProvenance } from '../safety/provenance.js'
import { audit } from '../audit/journal.js'
import { runHooks } from '../hooks/runner.js'
import { logEvent } from '../telemetry/logger.js'
import type { Profile } from '../profiles/schema.js'
import type { RunBudget } from '../runs/budget.js'
import { ArtifactRuntimeDeniedError, type ArtifactExecutionRequest } from './index.js'

export interface ArtifactGeneratorGate {
  user: string
  profile: Profile
  budget?: RunBudget
  signal?: AbortSignal
  confirmed: boolean
}

/**
 * Build the production artifact executor from the same registered tool set
 * used by the agent loop. Artifact recipes may refer to registered tools only;
 * code_ref is lineage metadata and is never treated as executable code here.
 */
export function createArtifactGenerator(skills: Skill[] = []) {
  return async (request: ArtifactExecutionRequest, gate: ArtifactGeneratorGate): Promise<{ payload: unknown }> => {
    if (request.codeRef) throw new ArtifactRuntimeDeniedError('source', `code_ref execution is unsupported for artifact refresh: ${request.codeRef}`)
    const tool = getAllTools().find(candidate => candidate.name === request.generatingTool)
    if (!tool) throw new Error(`registered artifact generator not found: ${request.generatingTool}`)

    const session = createSession(gate.profile.name, gate.user)
    const memory = gate.profile.memory?.provider === 'graph'
      ? new GraphMemoryProvider(gate.profile.artifact_dir, session)
      : new FsMemoryProvider(gate.profile.artifact_dir, session)
    const events: AgentLoopEvents = {
      onToken: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onToolPrompt: async () => false,
      onSessionEnd: () => {},
    }
    const artifactProvider = createProvider(gate.profile)
    const context: ToolContext = {
      profile: gate.profile,
      session,
      workingDir: gate.profile.working_dir,
      memory,
      skills,
      mcpEntries: [],
      events,
      openai: gate.profile.model.auth === 'codex_oauth' ? undefined : createProviderClient(gate.profile),
      provider: artifactProvider,
      signal: gate.signal,
      delegateDepth: 0,
      budget: gate.budget,
      approvalMode: 'danger',
      unattended: false,
      taintSources: [],
      runId: `artifact-refresh:${request.recipe.id}:${request.recipe.revision}`,
      currentToolCallId: `artifact-refresh:${request.recipe.id}:${request.recipe.revision}`,
      currentToolName: request.generatingTool,
    }
    context.provider = bindRunProvider(artifactProvider, context)

    const input = { ...request.parameters }
    const decision = await resolveAclDecisionWithMemory(request.generatingTool, input, gate.profile, memory, 'danger')
    const effect = effectFor(request.generatingTool)
    if (decision.value === 'deny') throw new ArtifactRuntimeDeniedError('approval', `artifact generator denied by profile ACL: ${decision.reason}`)
    if (decision.value === 'prompt' && !gate.confirmed) throw new ArtifactRuntimeDeniedError('approval', 'artifact generator requires explicit confirmation')
    if (isGatedEffect(effect, gate.profile.safety?.gate_writes) && !gate.confirmed) throw new ArtifactRuntimeDeniedError('approval', 'effectful artifact generator requires explicit confirmation')

    await runHooks('pre_tool', gate.profile, { TOOL_NAME: request.generatingTool }, context.signal)
    const started = Date.now()
    let ok = false
    let returnedProvenance: 'trusted' | 'untrusted' = 'trusted'
    let returnedSource: string | undefined
    try {
      const returned = await tool.execute(input, context)
      const structured = typeof returned === 'string' ? { content: returned } : returned
      const fallback = defaultProvenance(request.generatingTool, input, context, false)
      returnedProvenance = structured.provenance ?? fallback.provenance
      returnedSource = structured.source ?? fallback.source
      if (returnedProvenance === 'untrusted') {
        session.taint_sources = [returnedSource ?? request.generatingTool]
        throw new ArtifactRuntimeDeniedError('tainted', `artifact generator returned untrusted content: ${returnedSource ?? request.generatingTool}`)
      }
      ok = true
      if (effect !== 'read') {
        audit({
          run_id: context.runId,
          session_id: session.id,
          user: gate.user,
          profile: gate.profile.name,
          tool: request.generatingTool,
          input,
          effect,
          decision: decision.value === 'prompt' ? 'prompt' : 'allow',
          decided_by: decision.decided_by,
          decided_reason: decision.reason,
          tainted: false,
          ok: true,
        })
      }
      const raw = structured.content
      let payload: unknown = raw
      try { payload = JSON.parse(raw) } catch { /* plain text payload is valid */ }
      return { payload }
    } catch (error) {
      audit({
        run_id: context.runId,
        session_id: session.id,
        user: gate.user,
        profile: gate.profile.name,
        tool: request.generatingTool,
        input,
        effect,
        decision: decision.value === 'prompt' ? 'prompt' : 'allow',
        decided_by: decision.decided_by,
        decided_reason: decision.reason,
        tainted: (session.taint_sources?.length ?? 0) > 0,
        ok: false,
      })
      throw error
    } finally {
      if (session.usage.input > 0 || session.usage.output > 0 || (session.usage.model_attempts ?? 0) > 0) recordUsage(gate.user, session.usage)
      await runHooks('post_tool', gate.profile, { TOOL_NAME: request.generatingTool, TOOL_OK: String(ok) }, context.signal)
      logEvent({ session: session.id, profile: gate.profile.name, kind: 'tool', name: request.generatingTool, duration_ms: Date.now() - started, ok })
    }
  }
}
