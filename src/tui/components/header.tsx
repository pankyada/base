import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../theme.js'

interface HeaderProps {
  profile: string
  sessionId: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  connected: boolean
}

export function Header({ profile, sessionId, tokensIn, tokensOut, costUsd, connected }: HeaderProps) {
  const inFormatted = tokensIn.toLocaleString()
  const outFormatted = tokensOut.toLocaleString()
  const costFormatted = `$${costUsd.toFixed(3)}`

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}
      borderStyle="single" borderColor={theme.border}>
      <Box gap={2}>
        {!connected && <Text color={theme.warn}>⚠ </Text>}
        <Text color={theme.accent} bold>● {profile}</Text>
        <Text color={theme.dim}>{sessionId}</Text>
      </Box>
      <Box gap={2}>
        <Text color={theme.dim}>in:<Text color={theme.text}>{inFormatted}</Text></Text>
        <Text color={theme.dim}>out:<Text color={theme.text}>{outFormatted}</Text></Text>
        <Text color={theme.warn}>{costFormatted}</Text>
      </Box>
    </Box>
  )
}
