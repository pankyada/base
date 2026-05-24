import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage } from '../hooks/use-messages.js'
import type { ClientMessage } from '../../types.js'
import { theme } from '../theme.js'

interface MessageProps {
  msg: ChatMessage
  onSend: (msg: ClientMessage) => void
  expanded?: boolean
}

/** Extract the most meaningful single argument for a tool invocation. */
function getKeyArg(name: string, input: Record<string, unknown>): string {
  const val =
    input.file_path ??
    input.path ??
    input.command ??
    input.pattern ??
    input.key ??
    input.name ??
    null
  if (!val) return ''
  const s = String(val)
  // For multi-line content (Write body), just show first line
  const first = s.split('\n')[0]
  return first.length > 70 ? first.slice(0, 67) + '…' : first
}

/** Format tool prompt input as readable key=value pairs instead of raw JSON. */
function formatInput(name: string, input: Record<string, unknown>): string {
  const entries = Object.entries(input)
  if (entries.length === 0) return ''
  if (entries.length === 1) {
    const [k, v] = entries[0]
    const s = String(v)
    return `${k}: ${s.length > 80 ? s.slice(0, 77) + '…' : s}`
  }
  return entries
    .map(([k, v]) => {
      const s = String(v).split('\n')[0]
      return `${k}: ${s.length > 40 ? s.slice(0, 37) + '…' : s}`
    })
    .join('  ')
}

const RESULT_PREVIEW_LINES = 10

export function Message({ msg, onSend, expanded = false }: MessageProps) {
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
      const color =
        msg.status === 'running' ? theme.accent
        : msg.status === 'ok' ? theme.success
        : theme.error
      const icon =
        msg.status === 'running' ? '▶'
        : msg.status === 'ok' ? '✓'
        : '✗'
      const suffix =
        msg.status === 'running' ? 'running…'
        : msg.duration_ms !== undefined ? `${msg.duration_ms}ms`
        : ''
      const keyArg = getKeyArg(msg.name, msg.input)

      const hasResult = !!msg.result && msg.status !== 'running'
      const resultLines = msg.result?.split('\n') ?? []
      const previewLines = resultLines.slice(0, RESULT_PREVIEW_LINES)
      const overflow = resultLines.length - RESULT_PREVIEW_LINES

      return (
        <Box flexDirection="column">
          {/* Summary line */}
          <Box gap={1}>
            <Text color={color}>⚙ {icon} {msg.name}</Text>
            {keyArg ? <Text color={theme.dim}>{keyArg}</Text> : null}
            {suffix ? <Text color={theme.dim}>→ {suffix}</Text> : null}
            {hasResult && !expanded ? (
              <Text color={theme.dim}>[^E expand]</Text>
            ) : null}
          </Box>

          {/* Expanded result */}
          {expanded && hasResult && (
            <Box
              flexDirection="column"
              marginLeft={2}
              marginTop={0}
              borderStyle="single"
              borderColor={theme.border}
              paddingX={1}
            >
              {previewLines.map((line, i) => (
                <Text key={i} color={msg.status === 'err' ? theme.error : theme.dim}>
                  {line}
                </Text>
              ))}
              {overflow > 0 && (
                <Text color={theme.dim}>… {overflow} more lines</Text>
              )}
            </Box>
          )}
        </Box>
      )
    }

    case 'tool-prompt':
      return (
        <Box
          borderStyle="single"
          borderColor={theme.warn}
          paddingX={1}
          flexDirection="column"
        >
          <Text color={theme.warn}>⚠ Allow {msg.name}? [y/N]</Text>
          <Text color={theme.dim}>{formatInput(msg.name, msg.input)}</Text>
        </Box>
      )
  }
}
