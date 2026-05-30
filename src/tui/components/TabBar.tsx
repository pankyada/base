import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'

export interface Tab {
  id: string
  label: string
}

interface Props {
  tabs: Tab[]
  active: number
}

export function TabBar({ tabs, active }: Props) {
  return (
    <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottomColor={C.border}>
      {tabs.map((t, i) => {
        const isActive = active === i
        return (
          <Box key={t.id} paddingX={2} paddingY={0}>
            <Text color={isActive ? C.accent : C.dim} underline={isActive}>
              {i + 1} {t.label} ✕
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
