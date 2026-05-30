import React from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { C } from '../theme.js'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  busy: boolean
  compact: boolean
}

export function Composer({ value, onChange, onSubmit, busy, compact }: Props) {
  return (
    <Box flexDirection="column" borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderTopColor={C.border} paddingTop={1} paddingX={1}>
      <Box>
        <Text color={C.accent} bold>› </Text>
        <Box flexGrow={1}>
           <TextInput
             value={value}
             onChange={onChange}
             onSubmit={onSubmit}
             placeholder={busy ? "Thinking..." : "Message harness..."}
           />
        </Box>
      </Box>
      {!compact && (
        <Box justifyContent="flex-end" marginTop={1}>
          <Text color={C.dim} dimColor>Enter to send</Text>
        </Box>
      )}
    </Box>
  )
}
