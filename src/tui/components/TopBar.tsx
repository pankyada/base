import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'
import { useClock } from '../hooks/useClock.js'

interface Props {
  profileName: string
  sessionId: string
  busy: boolean
  onPalette?: () => void
}

export function TopBar({ profileName, sessionId, busy }: Props) {
  const clock = useClock()
  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <Text color={C.accent} bold>◆ harness</Text>
        <Text color={C.dim}> │ </Text>
        <Text>model {profileName}</Text>
        <Text color={C.dim}> │ </Text>
        <Text>session #{sessionId}</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={busy ? C.accent : C.ok}>●</Text>
        <Text> {busy ? 'working' : 'ready'}</Text>
      </Box>
      <Box>
        <Text>{clock}</Text>
        <Text color={C.borderHi}>  [⌘K palette]</Text>
      </Box>
    </Box>
  )
}
