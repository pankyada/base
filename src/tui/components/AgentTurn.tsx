import React from 'react'
import { Box, Text } from 'ink'
import { Thinking } from './Thinking.js'
import { ToolCall } from './ToolCall.js'
import type { UIMessage } from '../../types.js'

interface Props {
  message: { content?: string }
  tools: any[]
}

export function AgentTurn({ message, tools }: Props) {
  const isDone = tools.every(t => t.status === 'done')
  const activeIdx = tools.findIndex(t => t.status === 'running')
  return (
    <Box flexDirection="column">
      {tools.length > 0 && (
        <Thinking steps={tools.map(t => `Running ${t.name}`)} active={activeIdx} done={isDone} />
      )}
      {tools.map(t => (
        <ToolCall
          key={t.id}
          tool={{ type: t.name || '', arg: JSON.stringify(t.input || {}), out: t.result || '', done: t.status === 'done' }}
          running={t.status === 'running'}
        />
      ))}
      {message.content && (
        <Box marginTop={1}>
          <Text>{message.content}</Text>
        </Box>
      )}
    </Box>
  )
}
