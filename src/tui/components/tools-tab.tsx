import React from 'react'
import { Box, Text } from 'ink'
import type { ToolEntry } from '../hooks/use-tools.js'
import { theme } from '../theme.js'

interface ToolsTabProps {
  tools: ToolEntry[]
}

export function ToolsTab({ tools }: ToolsTabProps) {
  const totalMs = tools.reduce((a, t) => a + (t.duration_ms ?? 0), 0)
  const errCount = tools.filter(t => t.status === 'err').length

  return (
    <Box flexDirection="column" paddingX={1}>
      {tools.length === 0 ? (
        <Text color={theme.dim}>(none yet)</Text>
      ) : (
        tools.map((t, i) => {
          const color =
            t.status === 'running' ? theme.accent
            : t.status === 'ok'    ? theme.success
            :                        theme.error
          const icon =
            t.status === 'running' ? '▶'
            : t.status === 'ok'    ? '✓'
            :                        '✗'
          const suffix =
            t.status === 'running'         ? 'running…'
            : t.duration_ms !== undefined  ? `${t.duration_ms}ms`
            :                                ''
          return (
            <Box key={i} gap={1} flexWrap="nowrap">
              <Text color={color}>{icon} {t.name}</Text>
              {suffix ? <Text color={theme.dim}>{suffix}</Text> : null}
            </Box>
          )
        })
      )}
      {tools.length > 0 && (
        <Box marginTop={1}>
          <Text color={theme.dim}>
            {tools.length} calls · {totalMs}ms · {errCount} err
          </Text>
        </Box>
      )}
    </Box>
  )
}
