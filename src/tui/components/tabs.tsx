import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../theme.js'

export type TabId = 'tools' | 'memory' | 'stats'

interface TabsProps {
  active: TabId
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'tools',  label: 'TOOLS'  },
  { id: 'memory', label: 'MEMORY' },
  { id: 'stats',  label: 'STATS'  },
]

export function Tabs({ active }: TabsProps) {
  return (
    <Box>
      {TABS.map(tab => (
        <Text
          key={tab.id}
          color={active === tab.id ? theme.tabActive : theme.tabInactive}
          bold={active === tab.id}
        >
          {active === tab.id ? `[${tab.label}]` : ` ${tab.label} `}
        </Text>
      ))}
    </Box>
  )
}
