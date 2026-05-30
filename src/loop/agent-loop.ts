import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'
import { Session } from '../session/types.js'
import { ToolContext, AgentLoopEvents } from '../tools/types.js'
import { getAllTools, toOpenAITools } from '../tools/registry.js'
import { getMcpToolDefinitions } from '../mcp/client.js'
import { getAcl, getMcpAcl } from '../tools/acl.js'
import { logEvent } from '../telemetry/logger.js'
import { runHooks } from '../hooks/runner.js'
import { maybeCondenseMessages } from './context-manager.js'

interface ToolResult {
  tool_call_id: string
  content: string
  name: string
  input: Record<string, unknown>
  ok: boolean
  isMcp: boolean
}

export async function runAgentLoop(
  userMessage: string,
  profile: Profile,
  session: Session,
  context: ToolContext,
  events: AgentLoopEvents,
  openai: OpenAI,
  signal?: AbortSignal
): Promise<void> {
  session.messages.push({ role: 'user', content: userMessage })

  const allTools = [
    ...getAllTools(),
    ...getMcpToolDefinitions(profile, context.mcpEntries ?? []),
    ...(context.agentTools ?? []),
  ]
  const openaiTools = toOpenAITools(allTools)

  while (true) {
    if (signal?.aborted) return

    await maybeCondenseMessages(session, profile, openai)

    const stream = await (openai.chat.completions as any).create({
      model: profile.model.id,
      messages: session.messages as OpenAI.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
    }, { signal })

    let assistantContent = ''
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>()
    let tokensIn = 0
    let tokensOut = 0

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      if (delta?.content) {
        assistantContent += delta.content
        events.onToken(delta.content)
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallMap.get(tc.index)
          if (!existing) {
            toolCallMap.set(tc.index, {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              args: tc.function?.arguments ?? '',
            })
          } else {
            existing.args += tc.function?.arguments ?? ''
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
          }
        }
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? 0
        tokensOut = chunk.usage.completion_tokens ?? 0
      }
    }

    const cost = estimateCost(profile.model.id, tokensIn, tokensOut)
    session.usage.input += tokensIn
    session.usage.output += tokensOut
    session.usage.cost_usd += cost
    events.onStats?.(session.usage.input, session.usage.output, session.usage.cost_usd)
    logEvent({
      session: session.id, profile: profile.name, kind: 'llm',
      model: profile.model.id, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: cost,
    })

    const toolCalls = [...toolCallMap.values()]

    if (toolCalls.length === 0) {
      const markerIdx = assistantContent.indexOf('__ARTIFACTS__')
      // Strip the marker+JSON from transcript so it doesn't re-enter LLM context
      const contentToStore = markerIdx !== -1
        ? assistantContent.slice(0, markerIdx).trimEnd()
        : assistantContent
      session.messages.push({ role: 'assistant', content: contentToStore })

      if (markerIdx !== -1 && events.onArtifacts) {
        try {
          const artifactsJson = assistantContent.slice(markerIdx + '__ARTIFACTS__'.length).trim()
          const artifacts = JSON.parse(artifactsJson)
          if (Array.isArray(artifacts)) {
            events.onArtifacts(session.id, artifacts)
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
    session.messages.push(assistantMsg)

    // --- Parallel tool execution (Strategy C) ---
    // allow tools batch in parallel; prompt/deny tools flush batch first then run serially

    const executeOneTool = async (
      tc: { id: string; name: string; args: string },
      input: Record<string, unknown>,
      isMcp: boolean
    ): Promise<ToolResult> => {
      await runHooks('pre_tool', profile, { TOOL_NAME: tc.name })

      const toolDef = allTools.find(t => t.name === tc.name)
      const toolStart = Date.now()
      let result: string
      let ok = true
      try {
        if (!toolDef) throw new Error(`Tool "${tc.name}" not found in registry`)
        result = await toolDef.execute(input, context)
      } catch (e: any) {
        result = `Error: ${e.message}`
        ok = false
      }
      const duration_ms = Date.now() - toolStart

      logEvent({
        session: session.id, profile: profile.name,
        kind: isMcp ? 'mcp' : 'tool',
        name: tc.name, duration_ms, ok,
      })
      await runHooks('post_tool', profile, { TOOL_NAME: tc.name, TOOL_OK: String(ok) })

      return { tool_call_id: tc.id, content: result, name: tc.name, input, ok, isMcp }
    }

    const toolResults: ToolResult[] = new Array(toolCalls.length)
    let pendingBatch: Array<{ tc: { id: string; name: string; args: string }; input: Record<string, unknown>; isMcp: boolean; idx: number }> = []

    const flushBatch = async () => {
      if (pendingBatch.length === 0) return
      // Fire onToolStart in LLM-specified order before parallel execution
      for (const { tc, input } of pendingBatch) {
        events.onToolStart(tc.name, input)
      }
      const batchResults = await Promise.all(
        pendingBatch.map(({ tc, input, isMcp }) => executeOneTool(tc, input, isMcp))
      )
      // Fire onToolEnd in LLM-specified order after all complete
      for (const r of batchResults) {
        events.onToolEnd(r.name, r.content)
      }
      for (let b = 0; b < pendingBatch.length; b++) {
        toolResults[pendingBatch[b].idx] = batchResults[b]
      }
      pendingBatch = []
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      let input: Record<string, unknown>
      try { input = JSON.parse(tc.args || '{}') } catch { input = {} }
      const isMcp = tc.name.includes('__')
      const acl = isMcp
        ? getMcpAcl(tc.name.split('__', 2)[0], tc.name.split('__', 2)[1], profile)
        : getAcl(tc.name, profile)

      if (acl === 'deny') {
        await flushBatch()
        toolResults[i] = {
          tool_call_id: tc.id,
          content: `Tool "${tc.name}" is denied by profile ACL.`,
          name: tc.name, input, ok: false, isMcp,
        }
      } else if (acl === 'prompt') {
        await flushBatch()
        const approved = await events.onToolPrompt(tc.id, tc.name, input)
        if (!approved) {
          toolResults[i] = {
            tool_call_id: tc.id,
            content: `User denied tool "${tc.name}".`,
            name: tc.name, input, ok: false, isMcp,
          }
        } else {
          events.onToolStart(tc.name, input)
          const r = await executeOneTool(tc, input, isMcp)
          events.onToolEnd(r.name, r.content)
          toolResults[i] = r
        }
      } else {
        // allow — add to pending batch
        pendingBatch.push({ tc, input, isMcp, idx: i })
      }
    }
    await flushBatch()

    // Push results in original LLM-specified order
    for (const r of toolResults) {
      session.messages.push({
        role: 'tool', tool_call_id: r.tool_call_id, content: r.content,
      } as any)
      session.tool_calls.push({
        name: r.name, input: r.input, result: r.content, ok: r.ok, ts: new Date().toISOString(),
      })
    }
  }
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  void model
  return (tokensIn * 0.000003) + (tokensOut * 0.000015)
}
