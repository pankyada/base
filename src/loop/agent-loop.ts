import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { Profile } from '../profiles/schema.js'
import { Session } from '../session/types.js'
import { ToolContext, AgentLoopEvents } from '../tools/types.js'
import { getAllTools, toOpenAITools } from '../tools/registry.js'
import { getMcpToolDefinitions } from '../mcp/client.js'
import { resolveAcl, resolveAclDecisionWithMemory } from '../tools/acl.js'
import { audit } from '../audit/journal.js'
import { effectFor, isGatedEffect } from '../tools/effects.js'
import { defaultProvenance } from '../safety/provenance.js'
import { classify } from '../safety/classifier.js'
import { classifyStatic } from '../safety/rules.js'
import { logEvent } from '../telemetry/logger.js'
import { runHooks } from '../hooks/runner.js'
import { project, projectionTelemetry } from '../context/projection.js'
import { calibrate, estimateTokens, rawTokens } from '../context/estimator.js'
import { estimateCost, requiresReasoningEffortNone } from '../models/registry.js'
import type { StageTag } from '../workflow/types.js'
import { stageAcl } from '../workflow/stage-acl.js'
import { isParkSignal, ParkSignal } from '../runs/park.js'
import { bindRunProvider } from '../provider/invocation.js'
import { createApiKeyProvider } from '../provider/api-key.js'
import type { ProviderClient, ProviderMessage, ProviderRequest } from '../provider/types.js'
import { ProviderError } from '../provider/errors.js'

export { estimateCost }

function parseToolArguments(value: string, toolName: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value || '{}') } catch { throw new ProviderError(`Invalid arguments for tool ${toolName}`, { code: 'invalid_arguments' }) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderError(`Invalid arguments for tool ${toolName}`, { code: 'invalid_arguments' })
  }
  return parsed as Record<string, unknown>
}

// Ceiling on a single tool result's contribution to session.messages. Several
// tools (Read, ExecuteCode, Grep) have no output cap of their own, and a
// single oversized result can exceed the provider's per-message size limit
// (observed: a 20MB tool result 400'd against a 10MB ceiling). Full,
// untruncated output still lands in session.tool_calls for telemetry/replay —
// only what goes to the LLM is capped.
const MAX_TOOL_RESULT_CHARS = 100_000

interface ToolResult {
  tool_call_id: string
  content: string
  name: string
  input: Record<string, unknown>
  ok: boolean
  isMcp: boolean
  provenance: 'trusted' | 'untrusted'
  source?: string
}

export async function runAgentLoop(
  userMessage: string,
  profile: Profile,
  session: Session,
  context: ToolContext,
  events: AgentLoopEvents,
  openai?: OpenAI,
  signal?: AbortSignal,
  opts?: {
    modelId?: string
    stage?: StageTag
    appendUser?: boolean
    resumeApproval?: { toolCallId: string; approved: boolean; name: string; input: Record<string, unknown>; isMcp: boolean }
  }
): Promise<void> {
  const modelId = opts?.modelId ?? profile.model.id
  const apiClient = openai ?? context.openai
  const rawProvider: ProviderClient = context.provider ?? (apiClient ? createApiKeyProvider(profile, apiClient) : (() => { throw new Error('No model provider configured for this run') })())
  context.signal ??= signal
  const provider = bindRunProvider(rawProvider, context)
  context.provider = provider
  const stageOverlay = opts?.stage && opts.stage.stage !== 'triage' ? stageAcl(opts.stage.stage) : undefined
  if (opts?.appendUser !== false) {
    session.taint_sources = [...(context.taintSources ?? [])]
    session.messages.push({ role: 'user', content: userMessage })
  }

  const allTools = [
    ...getAllTools(),
    ...getMcpToolDefinitions(profile, context.mcpEntries ?? []),
    ...(context.agentTools ?? []),
  ]
  const openaiTools = toOpenAITools(allTools)
  let resumeApproval = opts?.resumeApproval

  const executeOneTool = async (
    tc: { id: string; name: string; args: string },
    input: Record<string, unknown>,
    isMcp: boolean,
    auditDecision: { decision: 'allow' | 'prompt'; decided_by: 'default' | 'predicate' | 'mode' | 'human' | 'gate'; reason: string } = { decision: 'allow', decided_by: 'default', reason: 'tool executed' },
  ): Promise<ToolResult> => {
    const owner = [...session.messages].reverse().find((message: any) => message?.role === 'assistant' && message.tool_calls?.some((call: any) => call.id === tc.id)) as any
    await context.provider?.assertCredentialGeneration?.(owner?.providerState?.accountGeneration)
    context.budget?.checkTool(tc.name, context.session.usage.cost_usd)
    await runHooks('pre_tool', profile, { TOOL_NAME: tc.name })
    signal?.throwIfAborted()
    context.signal?.throwIfAborted()
    await context.provider?.assertCredentialGeneration?.(owner?.providerState?.accountGeneration)

    const toolDef = allTools.find(t => t.name === tc.name)
    const toolStart = Date.now()
    let result: string
    let provenance: 'trusted' | 'untrusted'
    let source: string | undefined
    let effect = effectFor(tc.name, isMcp)
    let undo: ReturnType<typeof audit>['undo']
    let ok = true
    try {
      if (!toolDef) throw new Error(`Tool "${tc.name}" not found in registry`)
      const returned = await toolDef.execute(input, {
        ...context,
        currentToolCallId: tc.id,
        taintSources: session.taint_sources,
        stage: opts?.stage,
      })
      const structured = typeof returned === 'string' ? { content: returned } : returned
      result = structured.content
      const fallback = defaultProvenance(tc.name, input, context, isMcp)
      provenance = structured.provenance ?? fallback.provenance
      source = structured.source ?? fallback.source
      effect = effectFor(tc.name, isMcp, structured.effect)
      undo = structured.undo
    } catch (e: any) {
      if (isParkSignal(e)) throw e
      result = `Error: ${e.message}`
      ok = false
      const fallback = defaultProvenance(tc.name, input, context, isMcp)
      provenance = fallback.provenance
      source = fallback.source
    }
    const duration_ms = Date.now() - toolStart

    logEvent({
      session: session.id, profile: profile.name,
      kind: isMcp ? 'mcp' : 'tool',
      name: tc.name, duration_ms, ok,
    })
    await runHooks('post_tool', profile, { TOOL_NAME: tc.name, TOOL_OK: String(ok) })
    if (effect !== 'read') audit({ run_id: context.runId, session_id: session.id, user: session.user, profile: profile.name, tool: tc.name, input, effect, decision: auditDecision.decision, decided_by: auditDecision.decided_by, decided_reason: auditDecision.reason, tainted: (session.taint_sources?.length ?? 0) > 0, ok, ...(undo ? { undo } : {}) })
    if (provenance === 'untrusted') session.taint_sources = [...new Set([...(session.taint_sources ?? []), source ?? tc.name])].slice(0, 8)

    // Evidence is emitted here, after the real executor returned. Model-supplied
    // ids and prose never reach this callback.
    events.onEvidence?.(tc.id, tc.name, input, result, ok, provenance, source)

    return { tool_call_id: tc.id, content: result, name: tc.name, input, ok, isMcp, provenance, source }
  }

  while (true) {
    if (signal?.aborted) return
    context.budget?.checkModel(session.usage.cost_usd, modelId)

    if (resumeApproval) {
      const approval = resumeApproval
      resumeApproval = undefined
      if (approval.approved) {
        const result = await executeOneTool({ id: approval.toolCallId, name: approval.name, args: JSON.stringify(approval.input) }, approval.input, approval.isMcp, { decision: 'prompt', decided_by: 'human', reason: 'human approved prompt' })
        events.onToolEnd(result.tool_call_id, result.name, result.content, result.ok)
        session.messages.push({ role: 'tool', tool_call_id: result.tool_call_id, content: result.content } as any)
        session.tool_calls.push({ id: result.tool_call_id, name: result.name, input: result.input, result: result.content, ok: result.ok, ts: new Date().toISOString() })
      } else {
        const content = `User denied tool "${approval.name}".`
        events.onToolEnd(approval.toolCallId, approval.name, content, false)
        session.messages.push({ role: 'tool', tool_call_id: approval.toolCallId, content } as any)
        session.tool_calls.push({ id: approval.toolCallId, name: approval.name, input: approval.input, result: content, ok: false, ts: new Date().toISOString() })
      }
    }

    const projectedMessages = await project(
      session,
      profile,
      openai,
      context.memory,
      (message, detail) => events.onNotice?.('warn', message, detail),
      provider,
    )
    const sentRaw = rawTokens(projectedMessages)
    const contextTokensEst = estimateTokens(projectedMessages, session)

    let assistantContent = ''
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>()
    let completedResult: import('../provider/types.js').ProviderResult | undefined
    let tokensIn = 0
    let tokensOut = 0
    let cacheReadTokens: number | undefined
    const costBefore = session.usage.cost_usd
    try {
      const request: ProviderRequest = {
        model: modelId,
        messages: projectedMessages as ProviderMessage[],
        tools: allTools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
        stream: true,
        reasoningEffort: profile.model.auth === 'codex_oauth' ? profile.model.codex.reasoning_effort : undefined,
        signal,
      }
      for await (const event of provider.stream(request, {
        signal,
        sessionId: context.session.id,
        profileName: profile.name,
        purpose: 'main',
        credentialGeneration: context.credentialGeneration,
      })) {
        if (event.type === 'text') {
          assistantContent += event.delta
          events.onToken(event.delta)
        } else if (event.type === 'tool_delta') {
          const existing = [...toolCallMap.values()].find(call => call.id === event.id)
          if (existing) existing.args += event.argumentsDelta ?? ''
          else toolCallMap.set(toolCallMap.size, { id: event.id, name: event.name ?? '', args: event.argumentsDelta ?? '' })
        } else if (event.type === 'usage') {
          tokensIn = event.usage.inputTokens ?? 0
          tokensOut = event.usage.outputTokens ?? 0
          cacheReadTokens = event.usage.cachedInputTokens
        } else if (event.type === 'done') {
          completedResult = event.result
          if (event.result.text && event.result.text !== assistantContent) {
            events.onToken(event.result.text.startsWith(assistantContent) ? event.result.text.slice(assistantContent.length) : event.result.text)
            assistantContent = event.result.text
          }
          toolCallMap.clear()
          event.result.toolCalls.forEach((call, index) => toolCallMap.set(index, { id: call.id, name: call.name, args: call.arguments }))
          if (event.result.usage) {
            tokensIn = event.result.usage.inputTokens ?? tokensIn
            tokensOut = event.result.usage.outputTokens ?? tokensOut
            cacheReadTokens = event.result.usage.cachedInputTokens ?? cacheReadTokens
            }
        }
      }
    } catch (error) {
      if (!signal?.aborted) throw error
    }

    if (tokensIn > 0) calibrate(session, tokensIn, sentRaw)
    if (signal?.aborted) {
      if (assistantContent) session.messages.push({ role: 'assistant', content: assistantContent, interrupted: true } as any)
      events.onSessionEnd(session.id)
      return
    }

    const cost = session.usage.cost_usd - costBefore
    // A provider response can cross the ceiling; abort before any returned
    // tool call executes or a final over-budget turn is accepted.
    context.budget?.checkModel(session.usage.cost_usd, modelId)
    events.onStats?.(session.usage.input, session.usage.output, session.usage.cost_usd, estimateTokens(projectedMessages, session), undefined, session.usage)
    logEvent({
      session: session.id, profile: profile.name, kind: 'llm',
      model: modelId, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: cost,
      context_tokens_est: contextTokensEst,
      context_tokens_actual: tokensIn,
      calib_ratio: session.context?.calib.ratio,
      ...projectionTelemetry(projectedMessages),
      ...(cacheReadTokens === undefined ? {} : { cache_read_tokens: cacheReadTokens }),
      ...(opts?.stage ?? {}),
    })

    const toolCalls = [...toolCallMap.values()]

    if (toolCalls.length === 0) {
      const markerIdx = assistantContent.indexOf('__ARTIFACTS__')
      // Strip the marker+JSON from transcript so it doesn't re-enter LLM context
      const contentToStore = markerIdx !== -1
        ? assistantContent.slice(0, markerIdx).trimEnd()
        : assistantContent
      session.messages.push({ role: 'assistant', content: contentToStore, ...(completedResult?.continuation ? { providerState: completedResult.continuation } : {}) })

      if (markerIdx !== -1 && events.onArtifacts) {
        try {
          const artifactsJson = assistantContent.slice(markerIdx + '__ARTIFACTS__'.length).trim()
          const artifacts = JSON.parse(artifactsJson)
          if (Array.isArray(artifacts)) {
      const sourced = artifacts.map((artifact: any) => ({ ...artifact, source_session_id: session.id, source_tool_call_id: context.currentToolCallId ?? artifact.source_tool_call_id, source_tool_name: context.currentToolName ?? artifact.source_tool_name, source_code_id: context.sourceCodeId ?? artifact.source_code_id }))
            events.onArtifacts(session.id, sourced)
          }
        } catch {
          // Ignore invalid artifacts format
        }
      }

      events.onSessionEnd(session.id)
      return
    }

    const assistantMsg: any = {
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      })),
    }
    if (completedResult?.continuation) assistantMsg.providerState = completedResult.continuation
    session.messages.push(assistantMsg)

    // --- Parallel tool execution (Strategy C) ---
    // allow tools batch in parallel; prompt/deny tools flush batch first then run serially

    const toolResults: ToolResult[] = new Array(toolCalls.length)
    let pendingBatch: Array<{ tc: { id: string; name: string; args: string }; input: Record<string, unknown>; isMcp: boolean; idx: number; decision: { decision: 'allow'; decided_by: 'default' | 'predicate' | 'mode' | 'human' | 'gate'; reason: string } }> = []

    const parsedInputs: Record<string, unknown>[] = toolCalls.map(tc => parseToolArguments(tc.args, tc.name))

    const classifications = new Map<number, { risk: 'safe' | 'caution' | 'danger'; reason: string; source: string }>()
    if ((context.approvalMode ?? 'danger') === 'danger') {
      await Promise.all(toolCalls.map(async (tc, idx) => {
        const isMcp = tc.name.includes('__')
        const serverName = isMcp ? tc.name.split('__', 2)[0] : undefined
        const baseName = isMcp ? tc.name.split('__', 2)[1] : tc.name
        // Skip classification for calls the profile already denies outright —
        // resolveAcl will short-circuit to 'deny' below regardless of risk.
        if (resolveAcl(baseName, profile, 'danger', serverName, stageOverlay) === 'deny') return
        const verdict = context.openai
          ? await classify(tc.name, parsedInputs[idx], context)
          : { ...classifyStatic(tc.name, parsedInputs[idx], context.workingDir), source: 'static' as const }
        classifications.set(idx, verdict)
        if (verdict.source === 'model') events.onSafetyNotice?.(context.profile.safety?.classifier_model_id ?? context.profile.model.id)
      }))
    }

    const flushBatch = async () => {
      if (pendingBatch.length === 0) return
      // Fire onToolStart in LLM-specified order before parallel execution
      for (const { tc, input } of pendingBatch) {
        events.onToolStart(tc.id, tc.name, input)
      }
      const batchResults = await Promise.all(
        pendingBatch.map(({ tc, input, isMcp, decision }) => executeOneTool(tc, input, isMcp, decision))
      )
      // Fire onToolEnd in LLM-specified order after all complete
      for (const r of batchResults) {
        events.onToolEnd(r.tool_call_id, r.name, r.content, r.ok)
      }
      const last = batchResults.at(-1)
      if (last) { context.currentToolCallId = last.tool_call_id; context.currentToolName = last.name }
      for (let b = 0; b < pendingBatch.length; b++) {
        toolResults[pendingBatch[b].idx] = batchResults[b]
      }
      pendingBatch = []
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      const input = parsedInputs[i]
      const isMcp = tc.name.includes('__')
      const serverName = isMcp ? tc.name.split('__', 2)[0] : undefined
      const baseName = isMcp ? tc.name.split('__', 2)[1] : tc.name
      const decision = await resolveAclDecisionWithMemory(baseName, input, profile, context.memory, context.approvalMode ?? 'danger', serverName, stageOverlay)
      let acl = decision.value
      let risk: 'safe' | 'caution' | 'danger' | undefined
      let reason: string | undefined
      if ((context.approvalMode ?? 'danger') === 'danger' && acl !== 'deny') {
        const verdict = classifications.get(i)
        if (!verdict) throw new Error(`internal: missing danger-mode classification for tool call "${tc.name}"`)
        risk = verdict.risk
        reason = verdict.reason
        acl = verdict.risk === 'danger' ? 'prompt' : 'allow'
      }
      const effect = effectFor(baseName, isMcp)
      let finalDecision: { decision: 'allow' | 'prompt'; decided_by: 'default' | 'predicate' | 'mode' | 'human' | 'gate'; reason: string } = { decision: acl === 'prompt' ? 'prompt' : 'allow', decided_by: decision.decided_by, reason: decision.reason }
      if (acl !== 'deny' && profile.safety?.gate_untrusted_actions && (session.taint_sources?.length ?? 0) > 0 && isGatedEffect(effect, profile.safety?.gate_writes)) {
        acl = 'prompt'
        const sources = session.taint_sources!.join('; ')
        reason = `untrusted content: ${sources}`
        finalDecision = { decision: 'prompt', decided_by: 'gate', reason }
      }

      if (acl === 'deny') {
        await flushBatch()
        if (effect !== 'read') audit({ run_id: context.runId, session_id: session.id, user: session.user, profile: profile.name, tool: tc.name, input, effect, decision: 'deny', decided_by: decision.decided_by, decided_reason: decision.reason, tainted: (session.taint_sources?.length ?? 0) > 0, ok: false })
        toolResults[i] = {
          tool_call_id: tc.id,
          content: `Tool "${tc.name}" is denied by profile ACL.`,
          name: tc.name, input, ok: false, isMcp, provenance: 'trusted',
        }
        events.onToolStart(tc.id, tc.name, input)
        events.onToolEnd(tc.id, tc.name, toolResults[i].content, false)
      } else if (acl === 'prompt') {
        await flushBatch()
        events.onToolStart(tc.id, tc.name, input)
        if (context.unattended && context.pendingInputs && context.runId && context.channels?.enabled) {
          const created = new Date()
          const pending = context.pendingInputs.create({
            id: randomUUID().replace(/-/g, '').slice(0, 12),
            run_id: context.runId,
            session_id: session.id,
            user: session.user,
            profile: profile.name,
            prompt: `Approve ${tc.name}?${risk ? ` Risk: ${risk}.` : ''}${reason ? ` ${reason}` : ''}\n${JSON.stringify(input).slice(0, 500)}`,
            kind: 'select',
            options: ['Allow', 'Deny', 'Always'],
            tool_call_id: tc.id,
            purpose: 'approval',
            tool_name: tc.name,
            tool_input: input,
            is_mcp: isMcp,
            created_at: created.toISOString(),
            expires_at: new Date(created.getTime() + 15 * 60 * 1000).toISOString(),
          })
          const delivered = await context.channels.send(session.user, undefined, {
            text: pending.prompt,
            buttons: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }, { id: 'always', label: 'Always' }],
            correlation_id: pending.id,
          })
          if (delivered.ok) {
            events.onToolParked?.(tc.id, tc.name, input)
            throw new ParkSignal(pending.id)
          }
          context.pendingInputs.cancel(pending.id)
        }
        const approved = await events.onToolPrompt(tc.id, tc.name, input, risk, reason)
        if (!approved) {
          if (effect !== 'read') audit({ run_id: context.runId, session_id: session.id, user: session.user, profile: profile.name, tool: tc.name, input, effect, decision: 'deny', decided_by: finalDecision.decided_by === 'gate' ? 'gate' : 'human', decided_reason: finalDecision.decided_by === 'gate' ? finalDecision.reason : 'human denied prompt', tainted: (session.taint_sources?.length ?? 0) > 0, ok: false })
          toolResults[i] = {
            tool_call_id: tc.id,
            content: `User denied tool "${tc.name}".`,
            name: tc.name, input, ok: false, isMcp, provenance: 'trusted',
          }
          events.onToolEnd(tc.id, tc.name, toolResults[i].content, false)
        } else {
          const r = await executeOneTool(tc, input, isMcp, finalDecision.decided_by === 'gate' ? finalDecision : { decision: 'prompt', decided_by: 'human', reason: 'human approved prompt' })
          events.onToolEnd(r.tool_call_id, r.name, r.content, r.ok)
          toolResults[i] = r
        }
      } else {
        // allow — add to pending batch
        if (isMcp || ['Bash', 'ExecuteCode', 'Read', 'MemoryRead', 'Delegate', 'DelegateFanout'].includes(baseName)) {
          await flushBatch()
          events.onToolStart(tc.id, tc.name, input)
          const r = await executeOneTool(tc, input, isMcp, finalDecision)
          events.onToolEnd(r.tool_call_id, r.name, r.content, r.ok)
          toolResults[i] = r
        } else {
          pendingBatch.push({ tc, input, isMcp, idx: i, decision: { ...finalDecision, decision: 'allow' } })
        }
      }
    }
    await flushBatch()

    // Push results in original LLM-specified order
    for (const r of toolResults) {
      const content = r.content.length > MAX_TOOL_RESULT_CHARS
        ? r.content.slice(0, MAX_TOOL_RESULT_CHARS) + `\n[truncated ${r.content.length - MAX_TOOL_RESULT_CHARS} chars]`
        : r.content
      session.messages.push({
        role: 'tool', tool_call_id: r.tool_call_id, content,
      } as any)
      session.tool_calls.push({
        id: r.tool_call_id,
        name: r.name, input: r.input, result: r.content, ok: r.ok, ts: new Date().toISOString(),
      })
    }
  }
}
