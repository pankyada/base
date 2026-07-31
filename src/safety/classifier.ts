import type OpenAI from 'openai'
import { listModels } from '../models/registry.js'
import type { ToolContext } from '../tools/types.js'
import type { RiskLevel } from '../types.js'
import { logEvent } from '../telemetry/logger.js'
import { classifyStatic } from './rules.js'
import { DangerCache, verdictKey } from './cache.js'

export interface Classification {
  risk: RiskLevel
  reason: string
  source: 'static' | 'cache' | 'model' | 'failsafe'
}

// HARNESS_DANGER_CACHE_PATH lets tests and multi-instance deployments point
// the classifier at an isolated cache file instead of the real ~/.harness one.
const cache = process.env.HARNESS_DANGER_CACHE_PATH
  ? new DangerCache(process.env.HARNESS_DANGER_CACHE_PATH)
  : new DangerCache()

// A debounced write can otherwise be silently lost if the process exits
// (e.g. a one-shot REST run) before the 5s flush timer fires.
process.on('exit', () => cache.flushIfPending())

function classifierModel(ctx: ToolContext): string {
  if (ctx.profile.safety?.classifier_model_id) return ctx.profile.safety.classifier_model_id
  const sameProvider = listModels(ctx.profile).filter(model => model.available)
  return sameProvider.sort((a, b) => a.input_price + a.output_price - (b.input_price + b.output_price))[0]?.id ?? ctx.profile.model.id
}

function parseVerdict(value: string): { risk: RiskLevel; reason: string } | undefined {
  try {
    const parsed = JSON.parse(value) as { risk?: string; reason?: string }
    if (parsed.risk !== 'safe' && parsed.risk !== 'caution' && parsed.risk !== 'danger') return undefined
    return { risk: parsed.risk, reason: String(parsed.reason ?? 'classified tool call').slice(0, 120) }
  } catch {
    return undefined
  }
}

export async function classify(toolName: string, input: Record<string, unknown>, ctx: ToolContext): Promise<Classification> {
  const started = Date.now()
  const staticVerdict = classifyStatic(toolName, input, ctx.workingDir)
  if (staticVerdict.risk === 'safe' || staticVerdict.risk === 'danger') {
    return { ...staticVerdict, source: 'static' }
  }
  if (ctx.profile.safety?.enabled === false) {
    return { ...staticVerdict, source: 'static' }
  }

  const key = verdictKey(toolName, input)
  const ttl = ctx.profile.safety?.cache_ttl_hours ?? 168
  const cached = cache.get(key, ttl)
  if (cached) {
    logEvent({ session: ctx.session.id, profile: ctx.profile.name, kind: 'safety', name: toolName, duration_ms: Date.now() - started, ok: true })
    return { risk: cached.risk, reason: cached.reason, source: 'cache' }
  }

  const timeout = ctx.profile.safety?.timeout_ms ?? 3000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await (ctx.openai.chat.completions as any).create({
      model: classifierModel(ctx),
      max_tokens: 64,
      messages: [
        { role: 'system', content: 'Classify tool safety. Return strict JSON only: {"risk":"safe|caution|danger","reason":"12 words or fewer"}.' },
        { role: 'user', content: JSON.stringify({ tool: toolName, input }) },
      ],
    }, { signal: controller.signal })
    const content = response.choices?.[0]?.message?.content ?? ''
    const verdict = parseVerdict(content)
    if (!verdict) throw new Error('invalid classifier response')
    cache.set(key, verdict)
    logEvent({ session: ctx.session.id, profile: ctx.profile.name, kind: 'safety', name: toolName, duration_ms: Date.now() - started, ok: true })
    return { ...verdict, source: 'model' }
  } catch {
    logEvent({ session: ctx.session.id, profile: ctx.profile.name, kind: 'safety', name: toolName, duration_ms: Date.now() - started, ok: false })
    return { risk: 'danger', reason: 'classification unavailable', source: 'failsafe' }
  } finally {
    clearTimeout(timer)
  }
}
