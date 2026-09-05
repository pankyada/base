import type OpenAI from 'openai'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'
import type { ProviderClient, ProviderMessage } from '../provider/types.js'
import { createApiKeyProvider } from '../provider/api-key.js'
import { isProviderControlFailure } from '../provider/errors.js'

export interface Fact {
  text: string
  tags: string[]
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return fenced?.[1] ?? text
}

function digestPrompt(messages: unknown[]): string {
  return `Return ONLY JSON with this shape: {"digest":"concise summary","facts":[{"text":"durable fact","tags":["tag"]}]}. Summarise the supplied earlier session turns. Facts must be durable, actionable information worth promoting to project memory.\n\n${JSON.stringify(messages)}`
}

export async function buildDigest(
  session: Session,
  profile: Profile,
  openai: OpenAI | undefined,
  upto: number,
  memory?: MemoryProvider,
  provider?: ProviderClient,
): Promise<{ text: string; facts: Fact[] } | null> {
  const ledger = (session.messages as unknown[]).slice(1, Math.max(1, upto)).map(stripProviderState)
  if (ledger.length === 0) return null

  const model = profile.context?.digest_model_id ?? profile.models?.roles?.cheap ?? profile.model.id
  let content: string
  try {
    if (provider) {
      const response = await provider.generate({ model, stream: false, maxTokens: 512, temperature: 0, messages: [{ role: 'user', content: digestPrompt(ledger) }] })
      content = response.text.trim()
    } else if (openai) {
      const response = await (openai.chat.completions as any).create({
        model,
        max_tokens: 512,
        temperature: 0,
        messages: [{ role: 'user', content: digestPrompt(ledger) }],
      })
      content = typeof response.choices?.[0]?.message?.content === 'string' ? response.choices[0].message.content.trim() : ''
    } else return null
  } catch (error) {
    if (isProviderControlFailure(error)) throw error
    return null
  }
  if (!content) return null

  let text = content
  let facts: Fact[] = []
  try {
    const parsed = JSON.parse(extractJson(content)) as { digest?: unknown; facts?: unknown }
    if (typeof parsed.digest === 'string' && parsed.digest.trim()) text = parsed.digest.trim()
    if (Array.isArray(parsed.facts)) {
      facts = parsed.facts.filter((fact): fact is Fact => {
        const candidate = fact as any
        return typeof candidate?.text === 'string' && candidate.text.trim().length > 0 &&
          Array.isArray(candidate.tags) && candidate.tags.every((tag: unknown) => typeof tag === 'string')
      }).map(fact => ({ text: fact.text.trim(), tags: [...fact.tags] }))
    }
  } catch {
    // Provider returned useful plain text; keep it as the digest.
  }

  if (!text.trim()) return null
  if (memory) {
    for (const [index, fact] of facts.entries()) {
      await memory.write('project', `context-fact-${upto}-${index}`, fact.text)
    }
  }
  return { text, facts }
}

function stripProviderState(message: unknown): ProviderMessage {
  if (!message || typeof message !== 'object') return { role: 'user', content: String(message ?? '') }
  const { providerState: _providerState, ...publicMessage } = message as ProviderMessage
  return publicMessage
}
