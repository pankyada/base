import React from 'react'
import { Box, Text } from 'ink'
import type { MemoryKey } from '../hooks/use-memory.js'
import { theme } from '../theme.js'

interface MemoryTabProps {
  memoryKeys: MemoryKey[]
}

export function MemoryTab({ memoryKeys }: MemoryTabProps) {
  if (memoryKeys.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={theme.dim}>(empty)</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {memoryKeys.map((k, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text color={k.isNew ? theme.newMemory : theme.text}>📝 {k.key}</Text>
          {k.preview && (
            <Text color={theme.dim}>  {k.preview}</Text>
          )}
        </Box>
      ))}
    </Box>
  )
}
