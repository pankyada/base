import React from 'react'
import { Box } from 'ink'
import { Pane } from './Pane.js'

interface Props {
  split: boolean
  children: React.ReactNode
}

export function ConvColumn({ split, children }: Props) {
  if (!split) {
    return <Box flexGrow={1} flexDirection="column">{children}</Box>
  }
  return <Pane title="conversation" focused={true}>{children}</Pane>
}
