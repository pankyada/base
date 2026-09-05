import { ProviderError } from '../errors.js'
import type { ProviderEvent, ProviderResult, ProviderToolCall, ProviderUsage } from '../types.js'
import { Ajv, type ValidateFunction } from 'ajv'
import { validateContinuation, type CodexOpaqueItem } from './continuation.js'

export interface CodexStreamOptions {
  maxEventBytes?: number
  maxArgumentsBytes?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  knownTools?: Iterable<string>
  toolSchemas?: Record<string, Record<string, unknown>>
  accountGeneration?: string
  model?: string
}

interface CallState extends ProviderToolCall { itemId?: string; index?: number }

export async function* parseCodexSse(
  body: AsyncIterable<Uint8Array | string>,
  options: CodexStreamOptions = {},
): AsyncIterable<ProviderEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const maxEventBytes = options.maxEventBytes ?? 1024 * 1024
  const maxArgumentsBytes = options.maxArgumentsBytes ?? 1024 * 1024
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024
  const knownTools = options.knownTools ? new Set(options.knownTools) : undefined
  const toolSchemas = options.toolSchemas ?? {}
  const callsById = new Map<string, CallState>()
  const callsByItem = new Map<string, CallState>()
  const callsByIndex = new Map<number, CallState>()
  let buffer = ''
  let text = ''
  let usage: ProviderUsage | undefined
  let terminal = false
  let decoderDone = false

  if (options.signal?.aborted) throw abortError(options.signal)
  for await (const chunk of body) {
    if (options.signal?.aborted) throw abortError(options.signal)
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })

    while (true) {
      const match = /\r?\n\r?\n/.exec(buffer)
      if (!match) break
      const raw = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (Buffer.byteLength(raw) > maxEventBytes) throw new ProviderError('Codex SSE event exceeded size limit', { code: 'event_too_large' })
      const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data || data === '[DONE]') continue
      let event: unknown
      try { event = JSON.parse(data) } catch { throw new ProviderError('Codex SSE event contained invalid JSON', { code: 'invalid_sse' }) }
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new ProviderError('Codex SSE event must be a JSON object', { code: 'invalid_sse' })
      if (terminal) continue

      const normalized = normalizeEvent(event as Record<string, unknown>, {
        callsById, callsByItem, callsByIndex, maxArgumentsBytes, knownTools, toolSchemas,
        accountGeneration: options.accountGeneration, model: options.model,
      })
      for (const item of normalized) {
        if (item.type === 'text') {
          text += item.delta
          if (Buffer.byteLength(text) > maxOutputBytes) throw new ProviderError('Codex output exceeded size limit', { code: 'output_too_large', ambiguous: true })
        }
        if (item.type === 'usage') usage = item.usage
        if (item.type === 'done') {
          terminal = true
          const result = { ...item.result, text: item.result.text || text, usage: item.result.usage ?? usage }
          yield { type: 'done', result }
          return
        } else yield item
      }
    }
    if (Buffer.byteLength(buffer) > maxEventBytes) throw new ProviderError('Codex SSE event exceeded size limit', { code: 'event_too_large' })
  }
  if (!decoderDone) { buffer += decoder.decode(); decoderDone = true }
  if (options.signal?.aborted) throw abortError(options.signal)
  if (!terminal) throw new ProviderError('Codex stream ended before terminal response', { code: 'unexpected_eof', ambiguous: true })
}

interface NormalizeContext {
  callsById: Map<string, CallState>
  callsByItem: Map<string, CallState>
  callsByIndex: Map<number, CallState>
  maxArgumentsBytes: number
  knownTools?: Set<string>
  toolSchemas: Record<string, Record<string, unknown>>
  accountGeneration?: string
  model?: string
}

function normalizeEvent(event: Record<string, unknown>, context: NormalizeContext): ProviderEvent[] {
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'response.output_text.delta') return [{ type: 'text', delta: String(event.delta ?? '') }]
  if (type === 'response.function_call_arguments.delta') {
    const itemId = typeof event.item_id === 'string' ? event.item_id : undefined
    const index = typeof event.output_index === 'number' ? event.output_index : undefined
    const callId = typeof event.call_id === 'string' ? event.call_id : undefined
    const call = findCall(context, itemId, index, callId)
    if (!call) throw new ProviderError('Codex function argument delta has no output item', { code: 'orphan_tool_delta' })
    const delta = String(event.delta ?? '')
    call.arguments += delta
    if (Buffer.byteLength(call.arguments) > context.maxArgumentsBytes) throw new ProviderError('Codex function arguments exceeded size limit', { code: 'arguments_too_large' })
    return [{ type: 'tool_delta', id: call.id, name: call.name || undefined, argumentsDelta: delta }]
  }
  if (type === 'response.output_item.added') {
    const item = objectField(event, 'item')
    if (!item) throw new ProviderError('Codex output item missing item object', { code: 'invalid_output_item' })
    registerItem(item, event, context)
    return []
  }
  if (type === 'response.output_item.done') {
    const item = objectField(event, 'item')
    if (!item) throw new ProviderError('Codex output item missing item object', { code: 'invalid_output_item' })
    registerItem(item, event, context)
    return []
  }
  if (type === 'response.completed') return [{ type: 'done', result: completedResult(event, context) }]
  if (type === 'response.failed' || type === 'response.incomplete') throw new ProviderError(`Codex response ${type.slice('response.'.length)}`, { code: type })
  return []
}

function registerItem(item: Record<string, unknown>, event: Record<string, unknown>, context: NormalizeContext): void {
  const itemType = item.type
  if (itemType !== 'function_call') {
    if (itemType === 'message' || itemType === 'reasoning' || itemType === 'output_text') return
    throw new ProviderError(`unsupported Codex output item: ${String(itemType)}`, { code: 'unsupported_output_item' })
  }
  const itemId = typeof item.id === 'string' ? item.id : undefined
  const callId = typeof item.call_id === 'string' ? item.call_id : undefined
  if (!itemId && !callId) throw new ProviderError('Codex function call missing item and call id', { code: 'invalid_tool_call' })
  const index = typeof event.output_index === 'number' ? event.output_index : undefined
  let existing: CallState | undefined
  if (itemId) existing = context.callsByItem.get(itemId)
  if (!existing && callId) existing = context.callsById.get(callId)
  if (!existing && index !== undefined) existing = context.callsByIndex.get(index)
  const call: CallState = existing ?? { id: callId ?? '', name: '', arguments: '' }
  if (callId) { call.id = callId; context.callsById.set(callId, call) }
  if (itemId) { call.itemId = itemId; context.callsByItem.set(itemId, call) }
  if (index !== undefined) { call.index = index; context.callsByIndex.set(index, call) }
  if (typeof item.name === 'string') call.name = item.name
  if (typeof item.arguments === 'string' && item.arguments) call.arguments = item.arguments
  if (Buffer.byteLength(call.arguments) > context.maxArgumentsBytes) throw new ProviderError('Codex function arguments exceeded size limit', { code: 'arguments_too_large' })
  if (context.callsById.size > 128 || context.callsByItem.size > 128 || context.callsByIndex.size > 128) throw new ProviderError('Codex tool call count exceeded limit', { code: 'too_many_tools' })
}

function findCall(context: NormalizeContext, itemId?: string, index?: number, callId?: string): CallState | undefined {
  if (itemId) {
    const call = context.callsByItem.get(itemId)
    if (call) return call
  }
  if (callId) {
    const call = context.callsById.get(callId)
    if (call) return call
  }
  return index === undefined ? undefined : context.callsByIndex.get(index)
}

function completedResult(event: Record<string, unknown>, context: NormalizeContext): ProviderResult {
  const response = objectField(event, 'response')
  if (!response || !Array.isArray(response.output) || (response.status !== undefined && response.status !== 'completed')) {
    throw new ProviderError('Codex completed event has invalid response status or output', { code: 'invalid_terminal', ambiguous: true })
  }
  const output = response.output
  const completedIds = new Set<string>()
  const toolCalls: ProviderToolCall[] = []
  let outputText = ''
  let refusal = false
  const reasoningItems: CodexOpaqueItem[] = []
  for (const value of output) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError('Codex response output item is invalid', { code: 'invalid_output_item' })
    const item = value as Record<string, unknown>
    if (item.type === 'function_call') {
      registerItem(item, {}, context)
      const callId = typeof item.call_id === 'string' ? item.call_id : ''
      if (completedIds.has(callId)) throw new ProviderError('Codex response contains duplicate call id', { code: 'duplicate_call', ambiguous: true })
      completedIds.add(callId)
      const call = context.callsById.get(callId)
      if (!callId || !call) throw new ProviderError('Codex function call missing call id', { code: 'invalid_tool_call' })
      if (context.knownTools && !context.knownTools.has(call.name)) throw new ProviderError(`unknown Codex tool: ${call.name}`, { code: 'unknown_tool' })
      validateArguments(call.arguments, call.name, context.toolSchemas)
      toolCalls.push({ id: call.id, name: call.name, arguments: call.arguments })
    } else if (item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : []
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        const partRecord = part as Record<string, unknown>
        if (partRecord.type === 'output_text') outputText += String(partRecord.text ?? '')
        if (partRecord.type === 'refusal') refusal = true
      }
    } else if (item.type === 'reasoning') {
      reasoningItems.push(reasoningItem(item))
    } else if (item.type !== 'output_text') {
      throw new ProviderError(`unsupported Codex output item: ${String(item.type)}`, { code: 'unsupported_output_item' })
    }
  }
  if ([...context.callsById.keys()].some(id => !completedIds.has(id))) throw new ProviderError('Codex terminal output omitted a streamed call', { code: 'invalid_terminal', ambiguous: true })
  if (refusal && toolCalls.length) throw new ProviderError('Codex response mixed refusal with executable tools', { code: 'invalid_terminal', ambiguous: true })
  const usageValue = objectField(response, 'usage')
  const inputTokens = numberField(usageValue, 'input_tokens') ?? numberField(usageValue, 'prompt_tokens')
  const outputTokens = numberField(usageValue, 'output_tokens')
  const usage: ProviderUsage | undefined = usageValue ? { inputTokens, outputTokens,
    cachedInputTokens: numberField(objectField(usageValue, 'input_tokens_details'), 'cached_tokens'),
    reasoningOutputTokens: numberField(objectField(usageValue, 'output_tokens_details'), 'reasoning_tokens'),
    status: inputTokens !== undefined && outputTokens !== undefined ? 'complete' : 'unknown' } : undefined
  const continuation = context.accountGeneration && context.model
    ? { version: 1 as const, accountGeneration: context.accountGeneration, model: context.model, items: reasoningItems, anchorCallIds: toolCalls.map(call => call.id) }
    : undefined
  if (continuation) validateContinuation(continuation, { model: context.model, accountGeneration: context.accountGeneration })
  return { text: outputText, toolCalls, usage, continuation, finishReason: refusal ? 'refusal' : toolCalls.length ? 'tool_calls' : 'stop' }
}

function validateArguments(value: string, name: string, schemas: Record<string, Record<string, unknown>>): void {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new ProviderError('Codex function arguments are invalid JSON', { code: 'invalid_arguments' }) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProviderError('Codex function arguments must be a JSON object', { code: 'invalid_arguments' })
  const schema = schemas[name]
  if (!schema) return
  try {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate: ValidateFunction = ajv.compile(schema)
    if (!validate(parsed)) throw new ProviderError('Codex function arguments failed tool schema validation', { code: 'invalid_arguments' })
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError('Codex tool schema is invalid', { code: 'invalid_tool_schema' })
  }
}

function reasoningItem(item: Record<string, unknown>): CodexOpaqueItem {
  const allowed = new Set(['type', 'id', 'encrypted_content', 'summary', 'status', 'content'])
  if (Object.keys(item).some(key => !allowed.has(key))) throw new ProviderError('Codex reasoning item contained unsupported fields', { code: 'invalid_continuation' })
  const result: CodexOpaqueItem = { type: 'reasoning' }
  if (item.id !== undefined) {
    if (typeof item.id !== 'string') throw new ProviderError('Codex reasoning item id is invalid', { code: 'invalid_continuation' })
    result.id = item.id
  }
  if (item.encrypted_content !== undefined && item.encrypted_content !== null) {
    if (typeof item.encrypted_content !== 'string') throw new ProviderError('Codex reasoning content is invalid', { code: 'invalid_continuation' })
    result.encrypted_content = item.encrypted_content
  }
  if (item.summary !== undefined) {
    if (!Array.isArray(item.summary)) throw new ProviderError('Codex reasoning summary is invalid', { code: 'invalid_continuation' })
    result.summary = item.summary as CodexOpaqueItem['summary']
  }
  return result
}
function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined { const field = value[key]; return field && typeof field === 'object' && !Array.isArray(field) ? field as Record<string, unknown> : undefined }
function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const count = value?.[key]
  if (count === undefined || count === null) return undefined
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new ProviderError('Codex usage count is invalid', { code: 'invalid_usage', ambiguous: true })
  return count
}
function abortError(signal: AbortSignal): Error { const reason = signal.reason; return reason instanceof Error ? reason : new DOMException('The operation was aborted', 'AbortError') }
