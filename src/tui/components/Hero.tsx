import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'

interface Props {
  onSelect: (id: string) => void
}

export function Hero({ onSelect }: Props) {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1} width="100%">
      <Box marginBottom={2} flexDirection="column" alignItems="center">
        <Text color={C.dim}>  ┌─┐  agent control surface</Text>
        <Text color={C.dim}>  │<Text color={C.accent}>◆</Text>│  data · code · writing · research</Text>
        <Text color={C.dim}>  └─┘</Text>
      </Box>

      <Box marginBottom={2} flexDirection="column" alignItems="center">
        <Text color={C.accent} bold>◆ harness</Text>
        <Text color={C.dim}>A harness for an agent that does the work in the open.</Text>
      </Box>

      <Box width={60} flexDirection="column">
        <Box borderStyle="single" borderColor={C.border} padding={1} marginBottom={1}>
          <Text color={C.accent}>▟  </Text>
          <Text bold color={C.dim}>DATA ANALYSIS    </Text>
          <Text>Analyze Q2 revenue...    </Text>
          <Text color={C.faint}>↵ run task</Text>
        </Box>
        <Box borderStyle="single" borderColor={C.border} padding={1} marginBottom={1}>
          <Text color={C.accent}>❮❯ </Text>
          <Text bold color={C.dim}>CODING           </Text>
          <Text>Fix the race cond...     </Text>
          <Text color={C.faint}>↵ run task</Text>
        </Box>
        <Box borderStyle="single" borderColor={C.border} padding={1} marginBottom={1}>
          <Text color={C.accent}>✎  </Text>
          <Text bold color={C.dim}>WRITING          </Text>
          <Text>Draft a launch ann...    </Text>
          <Text color={C.faint}>↵ run task</Text>
        </Box>
        <Box borderStyle="single" borderColor={C.border} padding={1}>
          <Text color={C.accent}>◎  </Text>
          <Text bold color={C.dim}>RESEARCH         </Text>
          <Text>Map on-device LLM...     </Text>
          <Text color={C.faint}>↵ run task</Text>
        </Box>
      </Box>
    </Box>
  )
}
