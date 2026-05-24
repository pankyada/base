import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage } from '../hooks/use-messages.js'
import type { ClientMessage } from '../../types.js'
import { theme } from '../theme.js'

interface MessageProps {
  msg: ChatMessage
  onSend: (msg: ClientMessage) => void
}

export function Message({ msg, onSend }: MessageProps) {
  switch (msg.role) {
    case 'user':
      return (
        <Box>
          <Text color={theme.dim}>you: </Text>
          <Text color={theme.dim}>{msg.content}</Text>
        </Box>
      )

    case 'assistant':
      return (
        <Box flexDirection="column">
          <Text color={theme.text}>{msg.content}</Text>
          {msg.streaming && <Text color={theme.dim}>▌</Text>}
        </Box>
      )

    case 'tool-call': {
      const color = msg.status === 'running' ? theme.accent
        : msg.status === 'ok' ? theme.success
        : theme.error
      const icon = msg.status === 'running' ? '▶'
        : msg.status === 'ok' ? '✓'
        : '✗'
      const suffix = msg.status === 'running' ? 'running…'
        : msg.duration_ms !== undefined ? `${msg.duration_ms}ms`
        : ''
      return (
        <Box gap={1}>
          <Text color={color}>⚙ {icon} {msg.name}</Text>
          {suffix ? <Text color={theme.dim}>→ {suffix}</Text> : null}
        </Box>
      )
    }

    case 'tool-prompt':
      return (
        <Box borderStyle="single" borderColor={theme.warn} paddingX={1} flexDirection="column">
          <Text color={theme.warn}>⚠ Allow {msg.name}? [y/N]</Text>
          <Text color={theme.dim}>
            {JSON.stringify(msg.input).slice(0, 60)}
          </Text>
        </Box>
      )
  }
}
