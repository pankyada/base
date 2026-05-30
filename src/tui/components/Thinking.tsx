import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'
import { Spinner } from './Spinner.js'

interface Props {
  steps: string[]
  active: number
  done: boolean
}

export function Thinking({ steps, active, done }: Props) {
  if (steps.length === 0) return null
  return (
    <Box borderStyle="round" borderColor={C.dim} paddingX={1} flexDirection="column" marginY={1}>
      {steps.map((step, i) => {
        const isActive = i === active && !done
        const isDone = done || i < active
        return (
          <Box key={i}>
            <Text color={isActive ? C.text : C.dim}>
              {isDone ? '✓ ' : isActive ? <><Spinner />{' '}</> : '· '}
              {step}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
