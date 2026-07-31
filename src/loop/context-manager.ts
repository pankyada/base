import OpenAI from 'openai'
import { Session } from '../session/types.js'
import { Profile } from '../profiles/schema.js'
import { listModels } from '../models/registry.js'

export function estimateTokens(messages: unknown[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

export function contextWindowForProfile(profile: Profile): number {
  if (profile.context_window?.max_tokens) return profile.context_window.max_tokens
  return listModels(profile).find(model => model.id === profile.model.id)?.context_window ?? Infinity
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
  openai: OpenAI,
  force = false,
): Promise<number> {
  const maxTokens = contextWindowForProfile(profile)
  const before = estimateTokens(session.messages)
  if (!force && before <= maxTokens) return 0

  const messages = session.messages as any[]
  const keepSet = new Set<number>()

  // Always keep: system message (index 0)
  keepSet.add(0)

  // Always keep: last 6 messages
  for (let i = Math.max(1, messages.length - 6); i < messages.length; i++) {
    keepSet.add(i)
  }

  // Always keep: anchor tool messages (long markdown content) + their parent assistant messages
  for (let i = 1; i < messages.length; i++) {
    if (!isAnchor(messages[i])) continue
    keepSet.add(i)
    // Also keep the assistant message that issued this tool_call_id
    const toolCallId = (messages[i] as any).tool_call_id
    if (toolCallId) {
      for (let j = i - 1; j >= 0; j--) {
        const m = messages[j] as any
        if (m.role === 'assistant' && m.tool_calls?.some((tc: any) => tc.id === toolCallId)) {
          keepSet.add(j)
          break
        }
      }
    }
  }

  // Ensure no orphaned tool_call references:
  // for every kept assistant message with tool_calls, keep all its tool result messages
  for (const idx of [...keepSet]) {
    const m = messages[idx] as any
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue
    const tcIds = new Set<string>(m.tool_calls.map((tc: any) => tc.id as string))
    for (let k = idx + 1; k < messages.length; k++) {
      const sibling = messages[k] as any
      if (sibling.role === 'tool' && tcIds.has(sibling.tool_call_id)) {
        keepSet.add(k)
      } else if (sibling.role === 'assistant') {
        break // next turn, stop scanning
      }
    }
  }

  const summarisable = messages.filter((_, i) => !keepSet.has(i))
  if (summarisable.length === 0) return 0

  const modelId = profile.context_window?.model_id ?? profile.model.id
  let summary: string
  try {
    const resp = await (openai.chat.completions as any).create({
      model: modelId,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Summarise this conversation history concisely. Preserve: key decisions made, tasks completed, current goals, important values or file contents mentioned. Output plain text, no JSON.\n\n${JSON.stringify(summarisable)}`,
      }],
    })
    summary = resp.choices[0].message.content ?? 'No summary available.'
  } catch {
    return 0 // leave messages unchanged on failure
  }

  const summaryMsg = { role: 'user', content: `[Earlier conversation summary: ${summary}]` }
  const kept = messages.filter((_, i) => keepSet.has(i))
  // system message first, summary second, then rest of kept messages
  session.messages = [kept[0], summaryMsg, ...kept.slice(1)] as unknown[]
  return Math.max(0, before - estimateTokens(session.messages))
}
