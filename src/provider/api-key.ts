import OpenAI from 'openai'
import type { Profile } from '../profiles/schema.js'
import { requiresReasoningEffortNone } from '../models/registry.js'
import type { ModelCallContext, ProviderClient, ProviderEvent, ProviderMessage, ProviderRequest, ProviderResult, ProviderToolCall, ProviderUsage } from './types.js'
import { ProviderError } from './errors.js'
import { sanitizeError } from './auth/redact.js'

export function createApiKeyProvider(profile: Profile, client: OpenAI): ProviderClient {
  return {
    kind: 'api_key',
    model: profile.model.id,
    generate: async (request, context) => {
      let result: ProviderResult | undefined
      for await (const event of streamApi(client, request, context)) if (event.type === 'done') result = event.result
      if (!result) throw new ProviderError('API provider ended without a result', { code: 'unexpected_eof' })
      return result
    },
    stream: (request, context) => streamApi(client, request, context),
  }
}

async function* streamApi(client: OpenAI, request: ProviderRequest, context?: ModelCallContext): AsyncIterable<ProviderEvent> {
  const signal = context?.signal ?? request.signal
  const params = chatParams(request)
  let response: any
  context?.beforeAttempt?.()
  try {
    response = await (client.chat.completions.create as any)(params, { signal, ...(context?.beforeAttempt ? { maxRetries: 0 } : {}) })
  } catch (error: any) {
    throw new ProviderError(sanitizeError(error), { status: error?.status, retryable: error?.status === 429 || error?.status >= 500 })
  }
  if (request.stream === false) {
    yield { type: 'done', result: normalizeResponse(response) }
    return
  }

  let text = ''
  const calls = new Map<number, ProviderToolCall>()
  let usage: ProviderUsage | undefined
  try {
    for await (const chunk of response) {
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
      const delta = chunk.choices?.[0]?.delta
      if (delta?.content) {
        text += delta.content
        yield { type: 'text', delta: delta.content }
      }
      for (const item of delta?.tool_calls ?? []) {
        const current = calls.get(item.index) ?? { id: '', name: '', arguments: '' }
        if (item.id) current.id = item.id
        if (item.function?.name) current.name = item.function.name
        current.arguments += item.function?.arguments ?? ''
        calls.set(item.index, current)
        yield { type: 'tool_delta', id: current.id, name: item.function?.name, argumentsDelta: item.function?.arguments }
      }
      if (chunk.usage) {
        usage = normalizeUsage(chunk.usage)
        yield { type: 'usage', usage }
      }
    }
  } catch (error: any) {
    if (signal?.aborted) throw new ProviderError('API generation cancelled', { code: 'aborted' })
    throw new ProviderError(sanitizeError(error), { retryable: false, ambiguous: text.length > 0 })
  }
  yield { type: 'done', result: { text, toolCalls: [...calls.values()], usage, finishReason: calls.size ? 'tool_calls' : 'stop' } }
}

function chatParams(request: ProviderRequest): Record<string, unknown> {
  const tools = request.tools?.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
  const params: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(messageForChatCompletions),
    ...(tools?.length ? { tools } : {}),
    stream: request.stream !== false,
    ...(request.stream === false ? {} : { stream_options: { include_usage: true } }),
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    ...(request.maxCompletionTokens === undefined ? {} : { max_completion_tokens: request.maxCompletionTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(request.responseFormat === undefined ? {} : { response_format: request.responseFormat }),
    ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
  }
  if (!request.reasoningEffort && tools?.length && requiresReasoningEffortNone(request.model)) params.reasoning_effort = 'none'
  return params
}

function normalizeResponse(response: any): ProviderResult {
  const choice = response?.choices?.[0]
  const message = choice?.message
  const toolCalls: ProviderToolCall[] = (message?.tool_calls ?? []).map((call: any) => ({ id: String(call.id ?? ''), name: String(call.function?.name ?? ''), arguments: String(call.function?.arguments ?? '') }))
  return { text: typeof message?.content === 'string' ? message.content : '', toolCalls, usage: response?.usage ? normalizeUsage(response.usage) : undefined, finishReason: toolCalls.length ? 'tool_calls' : choice?.finish_reason === 'length' ? 'incomplete' : 'stop' }
}

function normalizeUsage(value: any): ProviderUsage {
  return {
    inputTokens: value.prompt_tokens ?? value.input_tokens,
    outputTokens: value.completion_tokens ?? value.output_tokens,
    cachedInputTokens: value.prompt_tokens_details?.cached_tokens ?? value.input_tokens_details?.cached_tokens ?? value.cache_read_tokens ?? value.cache_read_input_tokens,
    reasoningOutputTokens: value.completion_tokens_details?.reasoning_tokens ?? value.output_tokens_details?.reasoning_tokens,
    status: 'complete',
  }
}

function messageForChatCompletions(message: ProviderMessage): Record<string, unknown> {
  const { providerState: _providerState, ...publicMessage } = message
  if (!publicMessage.tool_calls) return publicMessage
  return {
    ...publicMessage,
    tool_calls: publicMessage.tool_calls.map(call => 'function' in call
      ? call
      : { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }),
  }
}
