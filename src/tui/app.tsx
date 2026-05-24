import React, { useState, useCallback } from 'react'
import { Box, useApp } from 'ink'
import { useWs } from './hooks/use-ws.js'
import { useMessages } from './hooks/use-messages.js'
import { useTools } from './hooks/use-tools.js'
import { useMemory } from './hooks/use-memory.js'
import { Header } from './components/header.js'
import { ChatPane } from './components/chat-pane.js'
import { RightPanel } from './components/right-panel.js'
import { InputBar } from './components/input-bar.js'
import type { ClientMessage } from '../types.js'

const PROFILE = process.env.HARNESS_PROFILE ?? 'coding'
const SESSION_ID = Math.random().toString(36).slice(2, 10)

export function App() {
  const { exit } = useApp()
  const { connected, send, lastMessage } = useWs()
  const { messages, dispatch } = useMessages(lastMessage)
  const tools = useTools(lastMessage)
  const memoryKeys = useMemory(lastMessage)

  const [tokensIn, setTokensIn] = useState(0)
  const [tokensOut, setTokensOut] = useState(0)
  const [costUsd, setCostUsd] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Track stats + generation state from WS messages
  React.useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'stats') {
      setTokensIn(lastMessage.tokens_in)
      setTokensOut(lastMessage.tokens_out)
      setCostUsd(lastMessage.cost_usd)
    }
    if (lastMessage.type === 'token') setGenerating(true)
    if (lastMessage.type === 'session_end') setGenerating(false)
    if (lastMessage.type === 'error') setGenerating(false)
  }, [lastMessage])

  // Find pending tool prompt id (most recent unresolved tool-prompt message)
  const pendingPrompt = messages
    .filter(m => m.role === 'tool-prompt' && m.pending)
    .at(-1)
  const pendingToolId = pendingPrompt?.id ?? null

  const handleSend = useCallback((msg: ClientMessage) => {
    if (msg.type === 'message') {
      dispatch({ event: 'user', content: msg.content })
      setGenerating(true)
      setScrollOffset(0)
    }
    if (msg.type === 'tool_approve' || msg.type === 'tool_deny') {
      dispatch({ event: 'tool_prompt_resolve', id: msg.id })
    }
    if (msg.type === 'cancel') setGenerating(false)
    send(msg)
  }, [send, dispatch])

  const handleClear = useCallback(() => {
    dispatch({ event: 'clear' })
    setExpandedIds(new Set())
    setScrollOffset(0)
  }, [dispatch])

  const handleScroll = useCallback((delta: number) => {
    setScrollOffset(o => Math.max(0, o + delta))
  }, [])

  const handleExpandToggle = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Ctrl+E — toggle the most recent completed tool-call */
  const handleExpandLast = useCallback(() => {
    const last = [...messages]
      .reverse()
      .find(m => m.role === 'tool-call' && m.status !== 'running')
    if (last) handleExpandToggle(last.id)
  }, [messages, handleExpandToggle])

  return (
    <Box flexDirection="column" height="100%">
      <Header
        profile={PROFILE}
        sessionId={SESSION_ID}
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        costUsd={costUsd}
        connected={connected}
      />
      <Box flexDirection="row" flexGrow={1}>
        <ChatPane
          messages={messages}
          scrollOffset={scrollOffset}
          onScroll={handleScroll}
          onSend={handleSend}
          expandedIds={expandedIds}
          onExpandToggle={handleExpandToggle}
        />
        <RightPanel
          tools={tools}
          memoryKeys={memoryKeys}
          tokensIn={tokensIn}
          tokensOut={tokensOut}
          costUsd={costUsd}
        />
      </Box>
      <InputBar
        onSend={handleSend}
        onClear={handleClear}
        onScroll={handleScroll}
        onExpandLast={handleExpandLast}
        pendingToolId={pendingToolId}
        disabled={generating}
      />
    </Box>
  )
}
