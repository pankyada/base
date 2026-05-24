import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage } from '../hooks/use-messages.js'
import type { ClientMessage } from '../../types.js'
import { Message } from './message.js'
import { theme } from '../theme.js'

interface ChatPaneProps {
  messages: ChatMessage[]
  scrollOffset: number
  onScroll: (delta: number) => void
  onSend: (msg: ClientMessage) => void
  expandedIds: Set<string>
  onExpandToggle: (id: string) => void
}

export function ChatPane({
  messages,
  scrollOffset,
  onScroll,
  onSend,
  expandedIds,
  onExpandToggle,
}: ChatPaneProps) {
  // Show up to last N messages based on scrollOffset
  const visible = messages.slice(Math.max(0, messages.length - 20 + scrollOffset))

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
      {visible.length === 0 ? (
        <Text color={theme.dim}>No messages yet. Type below to start.</Text>
      ) : (
        visible.map((msg, i) => (
          <Box key={msg.id ?? i} marginBottom={1}>
            <Message
              msg={msg}
              onSend={onSend}
              expanded={expandedIds.has(msg.id)}
            />
          </Box>
        ))
      )}
    </Box>
  )
}
