import type { ToolContext } from '../tools/types.js'
import type { ModelCallContext, ProviderClient, ProviderEvent, ProviderRequest, ProviderResult, ProviderUsage } from './types.js'
import { SharedAttemptBudget, isExplicitRejection } from './usage.js'
import { ProviderError } from './errors.js'
import { codexCapability } from './codex/models.js'
import { estimateCost } from '../models/registry.js'
import { abortable, delay, lifetime } from './auth/async.js'

const bindings = new WeakMap<ProviderClient, { raw: ProviderClient; context: ToolContext }>()
let active = 0
interface Waiter { signal: AbortSignal; grant(): void; cancel(): void }
const queue: Waiter[] = []

/** Bind every call (including helper calls) to one run's budget and session. */
export function bindRunProvider(provider: ProviderClient, context: ToolContext): ProviderClient {
  const existing = bindings.get(provider)
  if (existing?.context === context) return provider
  const raw = existing?.raw ?? provider
  context.attemptBudget ??= new SharedAttemptBudget(context.profile.model.auth === 'codex_oauth'
    ? context.profile.model.codex.max_model_calls_per_run : 1024)
  const bound: ProviderClient = {
    kind: raw.kind, model: raw.model, accountsUsage: true,
    assertCredentialGeneration: raw.assertCredentialGeneration?.bind(raw),
    stream: (request, call) => invoke(raw, context, request, call),
    async generate(request, call) {
      let result: ProviderResult | undefined
      for await (const event of invoke(raw, context, request, call)) if (event.type === 'done') result = event.result
      if (!result) throw new ProviderError('Provider ended without terminal result', { code: 'unexpected_eof', ambiguous: true })
      return result
    },
  }
  bindings.set(bound, { raw, context })
  return bound
}

async function* invoke(raw: ProviderClient, context: ToolContext, request: ProviderRequest, call: ModelCallContext = {}): AsyncIterable<ProviderEvent> {
  const codex = raw.kind === 'codex_oauth'
  const capability = codex ? codexCapability(request.model) : undefined
  if (codex && !capability) throw new ProviderError('Codex model has no validated capability', { code: 'unsupported_model' })
  const configured = context.profile.model.auth === 'codex_oauth' ? context.profile.model.codex.request_timeout_ms : 600_000
  const deadline = Math.min(call.deadline ?? Infinity, context.deadline ?? Infinity, context.budget?.deadlineAt() ?? Infinity, Date.now() + configured)
  const signals = [context.signal, request.signal, call.signal].filter((item): item is AbortSignal => Boolean(item))
  const signal = signals.length ? AbortSignal.any(signals) : undefined
  signal?.throwIfAborted()
  if (deadline <= Date.now()) throw new ProviderError('Model deadline exceeded', { code: 'deadline_exceeded' })
  context.budget?.checkModel(context.session.usage.cost_usd, request.model)
  const operation = lifetime(deadline - Date.now(), signal, 'Model call')
  const inputEstimate = Math.ceil(JSON.stringify(request.messages.map(message => {
    const { providerState: _opaque, ...plain } = message
    return plain
  })).length / 4) + Math.ceil(JSON.stringify(request.tools ?? []).length / 4)
  let usage: ProviderUsage | undefined
  let failure: unknown
  let finished = false
  let release: (() => void) | undefined
  const ledger = context.attemptBudget!.beginCall({
    inputEstimate, outputCeiling: capability?.maxOutputTokens, estimateUncertain: codex,
    usageSink: { record: item => recordUsage(context, raw, request.model, item) },
  })
  let visible = false
  let lastRejection: unknown
  let attempts = 0
  try {
    if (codex) release = await acquire(operation.signal)
    for (let retry = 0; ; retry++) {
      operation.signal.throwIfAborted()
      const beforeAttempt = () => {
        operation.signal.throwIfAborted()
        context.budget?.checkModel(context.session.usage.cost_usd, request.model)
        ledger.reserve()
        attempts++
        context.session.usage.model_attempts = (context.session.usage.model_attempts ?? 0) + 1
        call.beforeAttempt?.()
      }
      const iterator = raw.stream(request, { ...call, signal: operation.signal, deadline,
        sessionId: context.session.id, profileName: context.profile.name,
        rootRunId: context.runId ?? context.session.id, purpose: call.purpose ?? 'helper',
        beforeAttempt, credentialGeneration: call.credentialGeneration ?? context.credentialGeneration,
      })[Symbol.asyncIterator]()
      try {
        while (true) {
          const next = await abortable(iterator.next(), operation.signal)
          if (next.done) break
          const event = next.value
          if (event.type === 'text' || event.type === 'tool_delta') visible = true
          if (event.type === 'usage') usage = event.usage
          if (event.type === 'done') { usage = event.result.usage ?? usage; finished = true }
          yield event
        }
        if (!finished) throw new ProviderError('Provider stream ended before terminal result', { code: 'unexpected_eof', ambiguous: true })
        break
      } catch (error) {
        const canRetry = !visible && retry < 2 && error instanceof ProviderError &&
          error.retryable && error.options.ambiguous !== true && (error.status === 429 || (error.status ?? 0) >= 500)
        if (!canRetry) throw error
        lastRejection = error
        const wait = Math.max(0, error.options.retryAfterMs ?? 250 * 2 ** retry)
        if (!Number.isFinite(wait) || Date.now() + wait >= deadline) throw error
        context.events?.onNotice?.('warn', 'Provider throttled; retrying within run limits')
        await delay(wait, operation.signal)
      } finally {
        // A canceled or terminal stream must not wait indefinitely on transport cleanup.
        void iterator.return?.().catch(() => undefined)
      }
    }
  } catch (error) {
    failure = error instanceof ProviderError && error.code === 'max_model_calls' && lastRejection ? lastRejection : error
    throw error
  } finally {
    release?.()
    operation.close()
    ledger.finalize({ usage, error: failure })
    context.budget?.observeCost(context.session.usage.cost_usd)
    if (attempts > 0 && !failure) context.budget?.checkModel(context.session.usage.cost_usd, request.model)
  }
}

function recordUsage(context: ToolContext, provider: ProviderClient, model: string, usage: ProviderUsage): void {
  const total = context.session.usage
  const cost = estimateCost(model, usage.inputTokens ?? 0, usage.outputTokens ?? 0)
  const mode = provider.kind === 'codex_oauth' ? 'subscription' : 'api'
  const basis = provider.kind === 'codex_oauth' ? 'api_equivalent' : 'api_estimate'
  const previousCost = total.cost_usd
  total.input += usage.inputTokens ?? 0
  total.output += usage.outputTokens ?? 0
  total.cost_usd += cost
  total.billing_mode = total.billing_mode && total.billing_mode !== mode ? 'mixed' : mode
  total.cost_basis = (total.cost_basis && total.cost_basis !== basis) || (!total.cost_basis && previousCost > 0) ? 'mixed' : basis
  total.billed_cost_usd = null
  if (mode === 'subscription') total.api_equivalent_usd = (total.api_equivalent_usd ?? 0) + cost
  else total.api_estimate_usd = (total.api_estimate_usd ?? 0) + cost
  total.cached_input_tokens = (total.cached_input_tokens ?? 0) + (usage.cachedInputTokens ?? 0)
  total.reasoning_output_tokens = (total.reasoning_output_tokens ?? 0) + (usage.reasoningOutputTokens ?? 0)
  const rank = { complete: 0, partial: 1, unknown: 2, estimated: 3 }
  if (!total.usage_status || rank[usage.status] > rank[total.usage_status]) total.usage_status = usage.status
  context.usageSink?.record(usage)
}

function acquire(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      signal,
      grant() {
        signal.removeEventListener('abort', waiter.cancel)
        active++
        let released = false
        resolve(() => { if (released) return; released = true; active--; pump() })
      },
      cancel() {
        const index = queue.indexOf(waiter)
        if (index >= 0) queue.splice(index, 1)
        signal.removeEventListener('abort', waiter.cancel)
        reject(signal.reason ?? new DOMException('Operation aborted', 'AbortError'))
      },
    }
    signal.addEventListener('abort', waiter.cancel, { once: true })
    queue.push(waiter)
    pump()
  })
}
function pump(): void {
  while (active < 2 && queue.length) {
    const next = queue.shift()!
    if (next.signal.aborted) next.cancel()
    else next.grant()
  }
}
