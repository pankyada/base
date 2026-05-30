import React from 'react'
import { Text } from 'ink'
import { C } from '../theme.js'
import { useSpinner } from '../hooks/useSpinner.js'
export function Spinner() {
  return <Text color={C.accent}>{useSpinner()}</Text>
}
