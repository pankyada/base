import { randomUUID } from 'crypto'
import type { ToolDefinition } from '../types.js'
import type { InputRequestKind } from '../../types.js'
import { ParkSignal } from '../../runs/park.js'

export const askUserTool: ToolDefinition = {
  name: 'AskUser',
  description: 'Pause and ask the user a question. Use kind="text" for free text, "select" for one choice from options, "multi_select" for multiple choices from options. Set defer=true for a durable question that can outlive the process.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Question to ask the user' },
      kind: {
        type: 'string',
        enum: ['text', 'select', 'multi_select'],
        description: 'Input type',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required for select and multi_select kinds',
      },
      defer: { type: 'boolean', description: 'Park question durably for later answer' },
      ttl: { type: 'string', description: 'How long deferred question stays open, such as 4h or 2d' },
      channel: { type: 'string', description: 'Configured channel for deferred delivery' },
    },
    required: ['prompt', 'kind'],
  },
  async execute(input, context) {
    const { prompt, kind, options, defer, ttl, channel } = input as {
      prompt: string
      kind: InputRequestKind
      options?: string[]
      defer?: boolean
      ttl?: string
      channel?: string
    }

    if (defer) {
      if (context.pendingInputs && context.runId && context.currentToolCallId && context.channels?.enabled) {
        const created = new Date()
        const expires = new Date(created.getTime() + parseTtl(ttl ?? '24h'))
        const pending = context.pendingInputs.create({
          id: randomUUID().replace(/-/g, '').slice(0, 12),
          run_id: context.runId,
          session_id: context.session.id,
          user: context.session.user,
          profile: context.profile.name,
          prompt,
          kind,
          options,
          tool_call_id: context.currentToolCallId,
          channel,
          created_at: created.toISOString(),
          expires_at: expires.toISOString(),
        })
        const buttons = options?.map((label, index) => ({ id: String(index + 1), label }))
        const delivered = await context.channels.send(context.session.user, channel, {
          text: prompt,
          buttons: kind === 'text' ? undefined : buttons,
          correlation_id: pending.id,
        })
        if (delivered.ok) throw new ParkSignal(pending.id)
        context.pendingInputs.cancel(pending.id)
        if (!context.events.onInputRequest) return `[deferred ask unavailable: ${delivered.error ?? 'delivery failed'}]`
      } else if (!context.events.onInputRequest) {
        return '[deferred ask requires a channel or interactive client]'
      }
    }

    if (!context.events.onInputRequest) {
      return '[input_request not supported in this environment]'
    }

    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    const response = await context.events.onInputRequest(id, prompt, kind, options)
    return response
  },
}

function parseTtl(value: string): number {
  const match = /^(\d+)([mhd])$/.exec(value.trim().toLowerCase())
  if (!match) throw new Error(`invalid deferred ask ttl "${value}"; use values such as 30m, 4h, or 2d`)
  const amount = Number(match[1])
  const unit = match[2] === 'm' ? 60_000 : match[2] === 'h' ? 3_600_000 : 86_400_000
  return amount * unit
}
