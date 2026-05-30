import React from 'react'
import { Box, Text } from 'ink'
import { Pane } from './Pane.js'
import { TabBar, Tab } from './TabBar.js'
import { C } from '../theme.js'

interface Props {
  tabs: Tab[]
  activeTab: number
  children: React.ReactNode
}

export function Workspace({ tabs, activeTab, children }: Props) {
  return (
    <Pane title="workspace" focused={false}>
      <TabBar tabs={tabs} active={activeTab} />
      <Box flexGrow={1} flexDirection="column" padding={1} overflow="hidden">
        {children}
      </Box>
      <Box borderStyle="single" borderTopColor={C.border} borderBottom={false} borderLeft={false} borderRight={false} paddingX={1} justifyContent="space-between">
        <Text color={C.dim}>Surface 1/1</Text>
        <Text color={C.faint}>[Tab] switch pane  [1-4] switch tab</Text>
      </Box>
    </Pane>
  )
}
