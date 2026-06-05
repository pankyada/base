import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'

interface Props {
  busy: boolean
  focusPane: 'conv' | 'work'
  surface?: string
  surfaceIdx?: number
  surfaceTotal?: number
  tokens: { in: number; out: number }
  theme: string
  toolsExpanded?: boolean
}

export function StatusBar({ busy, focusPane, surface, surfaceIdx, surfaceTotal, tokens, theme, toolsExpanded }: Props) {
  return (
    <Box width="100%" justifyContent="space-between" marginTop={1}>
      <Box>
        <Box backgroundColor={C.accent} paddingX={1}>
          <Text color={C.bgDeep}>{busy ? 'RUN' : 'RDY'}</Text>
        </Box>
        <Text color={C.dim}> │ </Text>
        <Text color={focusPane === 'conv' ? C.text : C.dim}>conv</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={focusPane === 'work' ? C.text : C.dim}>work</Text>
        {surface && (
          <Box>
            <Text color={C.dim}> │ </Text>
            <Text>{surface} {surfaceIdx}/{surfaceTotal}</Text>
          </Box>
        )}
        <Text color={C.dim}> │ </Text>
        <Text>{tokens.in} in / {tokens.out} out</Text>
      </Box>
      <Box>
        <Text color={C.dim}>^O tools: {toolsExpanded ? 'on' : 'off'}</Text>
        <Text color={C.dim}> │ </Text>
        <Text>theme: {theme}</Text>
      </Box>
    </Box>
  )
}
