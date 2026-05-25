import OpenAI from 'openai'
import { Session } from '../session/types.js'
import { Profile } from '../profiles/schema.js'

function estimateTokens(messages: unknown[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

function isAnchor(msg: unknown): boolean {
  const m = msg as any
  if (m.role !== 'tool') return false
  const content: string = m.content ?? ''
  return content.length >= 400 && (content.startsWith('#') || content.includes('\n#'))
}

export async function maybeCondenseMessages(
  session: Session,
  profile: Profile,
  openai: OpenAI
): Promise<void> {
  const maxTokens = profile.context_window?.max_tokens ?? Infinity
  if (estimateTokens(session.messages) <= maxTokens) return

  const messages = session.messages as any[]
  const keepSet = new Set<number>()

  // Always keep: system message (index 0)
  keepSet.add(0)

  // Always keep: last 6 messages
  for (let i = Math.max(1, messages.length - 6); i < messages.length; i++) {
    keepSet.add(i)
  }

  // Always keep: anchor tool messages (long markdown content)
  for (let i = 1; i < messages.length; i++) {
    if (isAnchor(messages[i])) keepSet.add(i)
  }

  const summarisable = messages.filter((_, i) => !keepSet.has(i))
  if (summarisable.length === 0) return

  const modelId = profile.context_window?.model_id ?? profile.model.id
  let summary: string
  try {
    const resp = await (openai.chat.completions as any).create({
      model: modelId,
      messages: [{
        role: 'user',
        content: `Summarise this conversation history concisely. Preserve: key decisions made, tasks completed, current goals, important values or file contents mentioned. Output plain text, no JSON.\n\n${JSON.stringify(summarisable)}`,
      }],
    })
    summary = resp.choices[0].message.content ?? 'No summary available.'
  } catch {
    return // leave messages unchanged on failure
  }

  const summaryMsg = { role: 'user', content: `[Earlier conversation summary: ${summary}]` }
  const kept = messages.filter((_, i) => keepSet.has(i))
  // system message first, summary second, then rest of kept messages
  session.messages = [kept[0], summaryMsg, ...kept.slice(1)] as unknown[]
}
