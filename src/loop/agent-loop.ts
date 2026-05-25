import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'
import { Session } from '../session/types.js'
import { ToolContext } from '../tools/types.js'
import { getAllTools, toOpenAITools } from '../tools/registry.js'
import { getMcpToolDefinitions } from '../mcp/client.js'
import { getAcl, getMcpAcl } from '../tools/acl.js'
import { logEvent } from '../telemetry/logger.js'
import { runHooks } from '../hooks/runner.js'

export interface AgentLoopEvents {
  onToken(token: string): void
  onToolStart(name: string, input: Record<string, unknown>): void
  onToolEnd(name: string, result: string): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>): Promise<boolean>
  onSessionEnd(sessionId: string): void
  onStats?(tokens_in: number, tokens_out: number, cost_usd: number): void
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

  const allTools = [...getAllTools(), ...getMcpToolDefinitions(profile)]
  const openaiTools = toOpenAITools(allTools)

  while (true) {
    if (signal?.aborted) return

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
      session.messages.push({ role: 'assistant', content: assistantContent })
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

    for (const tc of toolCalls) {
      const name = tc.name
      let input: Record<string, unknown>
      try {
        input = JSON.parse(tc.args || '{}')
      } catch {
        input = {}
      }

      const isMcp = name.includes('__')
      let acl: string
      if (isMcp) {
        const [server, tool] = name.split('__', 2)
        acl = getMcpAcl(server, tool, profile)
      } else {
        acl = getAcl(name, profile)
      }

      if (acl === 'deny') {
        session.messages.push({
          role: 'tool', tool_call_id: tc.id,
          content: `Tool "${name}" is denied by profile ACL.`,
        } as any)
        continue
      }

      if (acl === 'prompt') {
        const approved = await events.onToolPrompt(tc.id, name, input)
        if (!approved) {
          session.messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: `User denied tool "${name}".`,
          } as any)
          continue
        }
      }

      await runHooks('pre_tool', profile, { TOOL_NAME: name })
      events.onToolStart(name, input)

      const toolDef = allTools.find(t => t.name === name)
      const toolStart = Date.now()
      let result: string
      let ok = true
      try {
        if (!toolDef) throw new Error(`Tool "${name}" not found in registry`)
        result = await toolDef.execute(input, context)
      } catch (e: any) {
        result = `Error: ${e.message}`
        ok = false
      }
      const duration_ms = Date.now() - toolStart

      logEvent({
        session: session.id, profile: profile.name,
        kind: isMcp ? 'mcp' : 'tool',
        name, duration_ms, ok,
      })
      await runHooks('post_tool', profile, { TOOL_NAME: name, TOOL_OK: String(ok) })
      events.onToolEnd(name, result)

      session.messages.push({
        role: 'tool', tool_call_id: tc.id, content: result,
      } as any)
      session.tool_calls.push({ name, input, result, ok, ts: new Date().toISOString() })
    }
  }
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  void model
  return (tokensIn * 0.000003) + (tokensOut * 0.000015)
}
