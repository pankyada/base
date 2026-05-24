import React from 'react'
import { Box, Text } from 'ink'
import type { ToolEntry } from '../hooks/use-tools.js'
import type { MemoryKey } from '../hooks/use-memory.js'
import { theme } from '../theme.js'

interface RightPanelProps {
  tools: ToolEntry[]
  memoryKeys: MemoryKey[]
  tokensIn: number
  tokensOut: number
  costUsd: number
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>{'─'.repeat(28)}</Text>
      <Text color={theme.dim}>{label}</Text>
    </Box>
  )
}

function ToolRow({ entry }: { entry: ToolEntry }) {
  const color = entry.status === 'running' ? theme.warn
    : entry.status === 'ok' ? theme.success
    : theme.error
  const icon = entry.status === 'running' ? '▶'
    : entry.status === 'ok' ? '✓'
    : '✗'
  const suffix = entry.status === 'running' ? 'running…'
    : entry.duration_ms !== undefined ? `${entry.duration_ms}ms`
    : ''

  return (
    <Box>
      <Text color={color}>{icon} {entry.name.slice(0, 10)}</Text>
      {suffix ? <Text color={theme.dim}> {suffix}</Text> : null}
    </Box>
  )
}

export function RightPanel({ tools, memoryKeys, tokensIn, tokensOut, costUsd }: RightPanelProps) {
  return (
    <Box flexDirection="column" width={28} borderStyle="single" borderColor={theme.border}>

      {/* TOOLS */}
      <Text color={theme.dim} bold>TOOLS</Text>
      {tools.length === 0
        ? <Text color={theme.dim}>  (none yet)</Text>
        : tools.slice(-8).map((t, i) => <ToolRow key={i} entry={t} />)
      }

      {/* MEMORY */}
      <SectionHeader label="MEMORY" />
      {memoryKeys.length === 0
        ? <Text color={theme.dim}>  (empty)</Text>
        : memoryKeys.map((k, i) => (
          <Box key={i}>
            {k.isNew
              ? <Text color={theme.newMemory}>+ {k.key}</Text>
              : <Text color={theme.dim}>📝 {k.key}</Text>
            }
          </Box>
        ))
      }

      {/* STATS */}
      <SectionHeader label="STATS" />
      <Text color={theme.dim}>in: <Text color={theme.text}>{tokensIn.toLocaleString()}</Text></Text>
      <Text color={theme.dim}>out: <Text color={theme.text}>{tokensOut.toLocaleString()}</Text></Text>
      <Text color={theme.dim}>cost: <Text color={theme.warn}>${costUsd.toFixed(3)}</Text></Text>

      {/* HINTS */}
      <SectionHeader label="" />
      <Text color={theme.dim}>^C cancel  ^L clear</Text>
      <Text color={theme.dim}>Tab profile  ↑↓ history</Text>

    </Box>
  )
}
