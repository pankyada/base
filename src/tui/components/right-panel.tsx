import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../theme.js'
import { Tabs, type TabId } from './tabs.js'
import { ToolsTab } from './tools-tab.js'
import { MemoryTab } from './memory-tab.js'
import { StatsTab } from './stats-tab.js'
import type { ToolEntry } from '../hooks/use-tools.js'
import type { MemoryKey } from '../hooks/use-memory.js'

interface RightPanelProps {
  tools: ToolEntry[]
  memoryKeys: MemoryKey[]
  tokensIn: number
  tokensOut: number
  costUsd: number
  activeTab: TabId
  sessionStart: number
}

export function RightPanel({
  tools, memoryKeys, tokensIn, tokensOut, costUsd, activeTab, sessionStart,
}: RightPanelProps) {
  return (
    <Box flexDirection="column" width={32} borderStyle="single" borderColor={theme.border}>

      <Tabs active={activeTab} />

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {activeTab === 'tools'  && <ToolsTab tools={tools} />}
        {activeTab === 'memory' && <MemoryTab memoryKeys={memoryKeys} />}
        {activeTab === 'stats'  && (
          <StatsTab
            tokensIn={tokensIn}
            tokensOut={tokensOut}
            costUsd={costUsd}
            tools={tools}
            sessionStart={sessionStart}
          />
        )}
      </Box>

      {/* Hints footer */}
      <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
        <Text color={theme.dim}>^C cancel  ^L clear  ^E expand</Text>
        <Text color={theme.dim}>Tab switch panel  ↑↓ scroll</Text>
        <Text color={theme.dim}>⇧↵ newline  ↵ send</Text>
      </Box>

    </Box>
  )
}
