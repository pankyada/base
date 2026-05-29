import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../theme.js'
import { useOrb } from '../hooks/use-orb.js'
import { Wave } from './wave.js'

interface HeaderProps {
  profile: string
  sessionId: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  connected: boolean
  generating: boolean
  narratorText: string
  narratorSlow: boolean
  waveBars: string
  waveRate: number
  contextWindow: number
}

export function Header({
  profile, sessionId, tokensIn, tokensOut, costUsd, connected,
  generating, narratorText, narratorSlow, waveBars, waveRate, contextWindow,
}: HeaderProps) {
  const { char, color } = useOrb(generating, costUsd)

  const pct = contextWindow > 0 ? tokensIn / contextWindow : 0
  const filled = Math.round(pct * 20)
  const bar = '▓'.repeat(Math.min(filled, 20)) + '░'.repeat(Math.max(20 - filled, 0))
  const barColor = pct > 0.8 ? theme.warn : theme.dim

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border}>

      {/* Row 1: identity + stats */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box gap={2}>
          {!connected && <Text color={theme.warn}>⚠ </Text>}
          <Text color={color} bold>{char} {profile}</Text>
          <Text color={theme.dim}>{sessionId}</Text>
        </Box>
        <Box gap={2}>
          <Text color={theme.dim}>in:<Text color={theme.text}>{tokensIn.toLocaleString()}</Text></Text>
          <Text color={theme.dim}>out:<Text color={theme.text}>{tokensOut.toLocaleString()}</Text></Text>
          <Text color={theme.warn}>${costUsd.toFixed(3)}</Text>
        </Box>
      </Box>

      {/* Row 2: narrator + wave (only while generating) */}
      {generating && narratorText ? (
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Text color={narratorSlow ? theme.warn : theme.dim}>{narratorText}</Text>
          <Wave bars={waveBars} rate={waveRate} visible={generating} />
        </Box>
      ) : null}

      {/* Row 3: context bar (only when context window is known) */}
      {contextWindow > 0 ? (
        <Box paddingX={1} gap={1}>
          <Text color={theme.dim}>ctx</Text>
          <Text color={barColor}>{bar}</Text>
          <Text color={theme.dim}>{Math.round(pct * 100)}% of {Math.round(contextWindow / 1000)}k</Text>
        </Box>
      ) : null}

    </Box>
  )
}
