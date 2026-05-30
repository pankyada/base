import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'

interface Props {
  title: string
  num?: number
  focused: boolean
  children: React.ReactNode
}

export function Pane({ title, num, focused, children }: Props) {
  return (
    <Box borderStyle="single" borderColor={focused ? C.accent : C.border} flexDirection="column" height="100%" flexGrow={1}>
      <Box marginTop={-1} marginLeft={2}>
        <Text color={C.borderHi}>┤</Text>
        <Text color={focused ? C.accent : C.dim}> ● {title} </Text>
        {num !== undefined && <Text color={C.faint}>{num}</Text>}
        <Text color={C.borderHi}>├</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {children}
      </Box>
    </Box>
  )
}
