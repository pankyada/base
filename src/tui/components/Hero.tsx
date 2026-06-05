import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'

interface Props {
  onSelect: (id: string) => void
  cols?: number
}

const TASKS = [
  { icon: '▟ ', label: 'DATA ANALYSIS', desc: 'Analyze Q2 revenue trends', id: 'data' },
  { icon: '❮❯', label: 'CODING       ', desc: 'Fix the race condition in worker pool', id: 'coding' },
  { icon: '✎ ', label: 'WRITING      ', desc: 'Draft a launch announcement', id: 'writing' },
  { icon: '◎ ', label: 'RESEARCH     ', desc: 'Map on-device LLM landscape', id: 'research' },
]

export function Hero({ onSelect, cols = 80 }: Props) {
  // Comfortable content width: at least 64, at most 100, centered with equal gutters
  const contentW = Math.min(Math.max(cols - 8, 64), 100)
  const padX = Math.floor((cols - contentW) / 2)

  return (
    <Box flexDirection="column" alignItems="flex-start" justifyContent="center" flexGrow={1} paddingX={padX}>

      {/* wordmark */}
      <Box marginBottom={1} flexDirection="column">
        <Text color={C.dim}>  ┌─┐  agent control surface</Text>
        <Text color={C.dim}>  │<Text color={C.accent}>◆</Text>│  data · code · writing · research</Text>
        <Text color={C.dim}>  └─┘</Text>
      </Box>

      <Box marginBottom={3} flexDirection="column">
        <Text color={C.accent} bold>◆ harness</Text>
        <Text color={C.dim}>A harness for an agent that does the work in the open.</Text>
      </Box>

      {/* task cards */}
      <Box flexDirection="column" width={contentW}>
        {TASKS.map((t, i) => (
          <Box
            key={t.id}
            borderStyle="single"
            borderColor={C.border}
            paddingX={2}
            paddingY={0}
            marginBottom={i < TASKS.length - 1 ? 1 : 0}
          >
            <Text color={C.accent}>{t.icon} </Text>
            <Text bold color={C.dim}>{t.label}  </Text>
            <Box flexGrow={1}>
              <Text>{t.desc}</Text>
            </Box>
            <Text color={C.faint}>  ↵ run task</Text>
          </Box>
        ))}
      </Box>

    </Box>
  )
}
