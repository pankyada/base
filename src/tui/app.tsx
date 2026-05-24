import React, { useState, useCallback, useRef } from 'react'
import { Box, useApp } from 'ink'
import { useWs } from './hooks/use-ws.js'
import { useMessages } from './hooks/use-messages.js'
import { useTools } from './hooks/use-tools.js'
import { useMemory } from './hooks/use-memory.js'
import { Header } from './components/header.js'
import { ChatPane } from './components/chat-pane.js'
import { RightPanel } from './components/right-panel.js'
import { InputBar } from './components/input-bar.js'
import type { ClientMessage, ServerMessage } from '../types.js'

const PROFILE = process.env.HARNESS_PROFILE ?? 'coding'
const SESSION_ID = Math.random().toString(36).slice(2, 10)

export function App() {
  const { exit } = useApp()

  const { messages, dispatch, handleMessage: messagesHandler } = useMessages()
  const { tools, handleMessage: toolsHandler } = useTools()
  const { memoryKeys, handleMessage: memoryHandler } = useMemory()

  const [tokensIn, setTokensIn] = useState(0)
  const [tokensOut, setTokensOut] = useState(0)
  const [costUsd, setCostUsd] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  /**
   * Single message handler passed to useWs — called directly from the WS
   * onmessage event, bypassing React state so no tokens are dropped when
   * streaming arrives faster than React can re-render.
   */
  const handleMessage = useCallback((msg: ServerMessage) => {
    // Fan out to each hook's handler
    messagesHandler(msg)
    toolsHandler(msg)
    memoryHandler(msg)

    // App-level stats / generation state
    if (msg.type === 'stats') {
      setTokensIn(msg.tokens_in)
      setTokensOut(msg.tokens_out)
      setCostUsd(msg.cost_usd)
    }
    if (msg.type === 'token') setGenerating(true)
    if (msg.type === 'session_end') setGenerating(false)
    if (msg.type === 'error') setGenerating(false)
  }, [messagesHandler, toolsHandler, memoryHandler])

  const { connected, send } = useWs(handleMessage)

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
