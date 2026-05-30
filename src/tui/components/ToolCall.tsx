import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'

interface Props {
  tool: { type: string; arg: string; out: string; done: boolean }
  running: boolean
}

export function ToolCall({ tool, running }: Props) {
  // We mock the open state for Ink since there's no native mouse click.
  // We'll default to expanded if there's output for now.
  const open = tool.done && tool.out && tool.out.length > 0

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Box width={15}>
          <Text color={running ? C.accent : C.dim}>{tool.type}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="truncate" color={running ? C.accent : C.dim}>{tool.arg}</Text>
        </Box>
        <Box width={3}>
          <Text color={running ? C.accent : C.dim}>{tool.done ? '✓' : '...'}</Text>
        </Box>
        <Box width={2}>
          <Text color={running ? C.accent : C.dim}>{open ? '▾' : '▸'}</Text>
        </Box>
      </Box>
      {open && (
        <Box marginLeft={2} borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderLeftColor={C.border} paddingLeft={1} backgroundColor={C.bgDeep}>
          <Text color={C.dim}>{tool.out}</Text>
        </Box>
      )}
    </Box>
  )
}
