import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { ToolEntry } from '../hooks/use-tools.js'
import { theme } from '../theme.js'

interface StatsTabProps {
  tokensIn: number
  tokensOut: number
  costUsd: number
  tools: ToolEntry[]
  sessionStart: number
}

export function StatsTab({ tokensIn, tokensOut, costUsd, tools, sessionStart }: StatsTabProps) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const duration = sessionStart > 0
    ? ((now - sessionStart) / 1000).toFixed(1)
    : '0.0'

  const completed = tools.filter(t => t.status !== 'running')
  const errCount = tools.filter(t => t.status === 'err').length
  const avgMs = completed.length > 0
    ? Math.round(completed.reduce((a, t) => a + (t.duration_ms ?? 0), 0) / completed.length)
    : 0

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.dim} bold>Tokens</Text>
      <Text color={theme.dim}>  in:  <Text color={theme.text}>{tokensIn.toLocaleString()}</Text></Text>
      <Text color={theme.dim}>  out: <Text color={theme.text}>{tokensOut.toLocaleString()}</Text></Text>
      <Text color={theme.dim}>Cost  <Text color={theme.warn}>${costUsd.toFixed(4)}</Text></Text>
      <Text color={theme.dim}>Dur   <Text color={theme.text}>{duration}s</Text></Text>
      <Text color={theme.dim}>{'─'.repeat(22)}</Text>
      <Text color={theme.dim}>Tools <Text color={theme.text}>{tools.length}</Text></Text>
      <Text color={theme.dim}>Errs  <Text color={theme.error}>{errCount}</Text></Text>
      <Text color={theme.dim}>Avg   <Text color={theme.text}>{avgMs}ms</Text></Text>
    </Box>
  )
}
