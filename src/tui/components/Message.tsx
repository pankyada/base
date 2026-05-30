import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'

interface Props {
  role: 'user' | 'agent'
  time: string
  children: React.ReactNode
}

export function Message({ role, time, children }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1} borderStyle={role === 'user' ? 'single' : undefined} borderTop={false} borderRight={false} borderBottom={false} borderLeftColor={C.info} paddingLeft={role === 'user' ? 1 : 0}>
      <Box marginBottom={1}>
        <Text color={C.dim}>
          {role === 'user' ? 'YOU › ' : 'HARNESS ◆ '}
          {time}
        </Text>
      </Box>
      <Box flexDirection="column">{children}</Box>
    </Box>
  )
}
