import { useState, useEffect } from 'react'
import type { ChatMessage, ToolCallMessage } from './use-messages.js'

const VERB_MAP: Record<string, string> = {
  Read:        'reading',
  Write:       'writing',
  Edit:        'editing',
  Bash:        'running',
  Glob:        'searching',
  Grep:        'searching',
  MemoryWrite: 'remembering',
  MemoryRead:  'recalling',
  Delegate:    'delegating',
}

export function getVerb(name: string): string {
  return VERB_MAP[name] ?? 'calling'
}

export function getTarget(msg: ToolCallMessage): string {
  const input = msg.input as Record<string, unknown>
  const val =
    input.file_path ??
    input.path ??
    input.command ??
    input.pattern ??
    input.key ??
    input.name ??
    input.profile ??
    null
  if (!val) return ''
  const s = String(val).split('\n')[0]
  return s.length > 50 ? s.slice(0, 47) + '…' : s
}

export function buildNarratorText(msg: ToolCallMessage, elapsedMs: number): string {
  const verb = getVerb(msg.name)
  const target = getTarget(msg)
  const elapsed = (elapsedMs / 1000).toFixed(1)
  const slow = elapsedMs > 3000 ? ' · ⚠ slow' : ''
  return `⚙ ${verb}${target ? ' ' + target : ''} · ${elapsed}s${slow}`
}

export function useNarrator(messages: ChatMessage[]) {
  const [elapsedMs, setElapsedMs] = useState(0)

  const running = [...messages]
    .reverse()
    .find((m): m is ToolCallMessage => m.role === 'tool-call' && m.status === 'running')

  useEffect(() => {
    if (!running) {
      setElapsedMs(0)
      return
    }
    const start = running.startTs
    setElapsedMs(Date.now() - start)
    const id = setInterval(() => setElapsedMs(Date.now() - start), 100)
    return () => clearInterval(id)
  }, [running?.id])

  if (!running) return { text: '', slow: false }

  const text = buildNarratorText(running, elapsedMs)
  const slow = elapsedMs > 3000

  return { text, slow }
}
