import type { EffortCapability } from '../../types.js'
import type { ProviderMessage, ProviderRequest, ProviderTool } from '../types.js'
import { assertCodexModel } from './models.js'
import { validateContinuation, type CodexContinuation } from './continuation.js'

export interface ResponsesRequest {
  model: string
  instructions: string
  input: unknown[]
  stream: true
  store: false
  tools?: Record<string, unknown>[]
  include: ['reasoning.encrypted_content']
  reasoning?: { effort?: string }
}

export function serializeCodexRequest(request: ProviderRequest, effortCapability?: EffortCapability): ResponsesRequest {
  const capability = assertCodexModel(request.model)
  const supportedEfforts = effortCapability
    ? effortCapability.status === 'supported'
      ? effortCapability.options.filter(option => option.selectable).map(option => option.value)
      : []
    : capability.efforts
  if (request.reasoningEffort === 'ultra' || (request.reasoningEffort && effortCapability?.stale)) {
    throw new Error(`reasoning effort ${request.reasoningEffort} is unavailable for ${request.model}`)
  }
  if (request.reasoningEffort && !supportedEfforts.includes(request.reasoningEffort)) {
    throw new Error(`reasoning effort ${request.reasoningEffort} is unsupported for ${request.model}`)
  }

  const instructionMessages = request.messages.filter(message => message.role === 'system' || message.role === 'developer')
  const instructions = request.instructions ?? instructionMessages.map(message => String(message.content)).join('\n')
  const input = request.messages
    .filter(message => message.role !== 'system' && message.role !== 'developer')
    .flatMap(message => messageToInput(message, request.model))

  const body: ResponsesRequest = {
    model: request.model,
    instructions,
    input,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(request.tools?.length ? { tools: request.tools.map(flatTool) } : {}),
  }
  if (request.reasoningEffort) {
    body.reasoning = {
      ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
    }
  }
  return body
}

function messageToInput(message: ProviderMessage, model: string): Record<string, unknown>[] {
  const expectedAnchors = message.tool_calls?.map(call => call.id) ?? []
  const state = parseContinuation(message.providerState, model, message.role, expectedAnchors)
  const prefix = state ? continuationItems(state) : []
  if (message.role === 'tool') {
    if (!message.tool_call_id) throw new Error('Codex tool result missing call id')
    return [...prefix, { type: 'function_call_output', call_id: message.tool_call_id, output: String(message.content) }]
  }
  if (message.tool_calls?.length) {
    return [
      ...prefix,
      ...(message.content ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: String(message.content) }] }] : []),
      ...message.tool_calls.map(call => {
        if ('function' in call) {
          return { type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments }
        }
        return { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }
      }),
    ]
  }
  if (typeof message.content === 'string') {
    return [...prefix, { type: 'message', role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }] }]
  }
  if (Array.isArray(message.content)) return [...prefix, { type: 'message', role: message.role, content: message.content.map(part => contentPart(part, message.role)) }]
  if (message.content === null && message.role === 'assistant') return prefix
  throw new Error(`unsupported Codex message content for ${message.role}`)
}

function contentPart(value: unknown, role: ProviderMessage['role']): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unsupported Codex content part')
  const part = value as Record<string, unknown>
  if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
    return { type: role === 'assistant' ? 'output_text' : 'input_text', text: String(part.text ?? '') }
  }
  if (role === 'user' && (part.type === 'image_url' || part.type === 'input_image')) {
    const image = typeof part.image_url === 'string' ? { url: part.image_url, detail: part.detail } : part.image_url as { url?: unknown; detail?: unknown } | undefined
    if (image && typeof image.url === 'string') {
      if (image.detail !== undefined && !['auto', 'low', 'high'].includes(String(image.detail))) throw new Error('unsupported Codex image detail')
      return { type: 'input_image', image_url: image.url, ...(image.detail ? { detail: image.detail } : {}) }
    }
  }
  throw new Error(`unsupported Codex content type: ${String(part.type)}`)
}

function flatTool(tool: ProviderTool): Record<string, unknown> {
  return { type: 'function', name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.parameters }
}

function continuationItems(value: CodexContinuation): Record<string, unknown>[] {
  return value.items.map(item => ({
    type: 'reasoning',
    ...(item.id ? { id: item.id } : {}),
    ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
  }))
}

function parseContinuation(value: unknown, model: string, role?: ProviderMessage['role'], anchorCallIds?: readonly string[]): CodexContinuation | undefined {
  if (value === undefined) return undefined
  if (role !== 'assistant') throw new Error('Codex continuation provider state must belong to an assistant message')
  if (typeof value === 'string') throw new Error('Codex continuation must be validated metadata, not encoded text')
  validateContinuation(value, { model, anchorCallIds })
  return value
}

/** Translate completed history after an explicit account/model switch without mutating saved provenance. */
export function prepareCodexHistory(request: ProviderRequest, accountGeneration: string): ProviderRequest {
  const resultIds = new Set(request.messages.filter(message => message.role === 'tool').map(message => message.tool_call_id))
  return { ...request, messages: request.messages.map(message => {
    if (message.providerState === undefined) return message
    validateContinuation(message.providerState, { anchorCallIds: message.tool_calls?.map(call => call.id) ?? [] })
    const state = message.providerState
    if (state.accountGeneration === accountGeneration && state.model === request.model) return message
    if (message.role !== 'assistant' || (message.tool_calls ?? []).some(call => !resultIds.has(call.id))) {
      throw new Error('Codex credential or model changed with pending tool calls; start a new session')
    }
    const { providerState: _state, ...translated } = message
    return translated
  }) }
}
