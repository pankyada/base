import React from 'react'
import { Text } from 'ink'
import { theme } from '../theme.js'

interface WaveProps {
  bars: string
  rate: number
  visible: boolean
}

export function Wave({ bars, rate, visible }: WaveProps) {
  if (!visible) return null
  return (
    <Text>
      <Text color={theme.accent}>{bars}</Text>
      <Text color={theme.dim}> {rate} t/s</Text>
    </Text>
  )
}
