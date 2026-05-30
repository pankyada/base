import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { C } from '../theme.js'

interface Props {
  onClose: () => void
  onRun: (id: string) => void
  onReset: () => void
}

const RUN_SCENARIOS = [
  { id: 'data', title: 'Run Data Analysis' },
  { id: 'coding', title: 'Run Coding Task' },
  { id: 'writing', title: 'Run Writing Task' },
  { id: 'research', title: 'Run Research Task' }
]

const SESSION_ACTIONS = [
  { id: 'reset', title: 'Clear Session' }
]

export function Palette({ onClose, onRun, onReset }: Props) {
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const items = [
    ...RUN_SCENARIOS.filter(s => s.title.toLowerCase().includes(filter.toLowerCase())).map(s => ({ ...s, group: 'RUN TASK' })),
    ...SESSION_ACTIONS.filter(s => s.title.toLowerCase().includes(filter.toLowerCase())).map(s => ({ ...s, group: 'SESSION' }))
  ]

  useInput((_input, key) => {
    if (key.escape) onClose()
    if (key.downArrow) setSelectedIndex(i => Math.min(i + 1, items.length - 1))
    if (key.upArrow) setSelectedIndex(i => Math.max(i - 1, 0))
    if (key.return && items.length > 0) {
      const item = items[selectedIndex]
      if (item.id === 'reset') onReset()
      else onRun(item.id)
      onClose()
    }
  })

  return (
    <Box position="absolute" width="100%" height="100%" justifyContent="center" alignItems="center">
      <Box width={60} flexDirection="column" borderStyle="single" borderColor={C.border} backgroundColor={C.panel}>
        <Box padding={1} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottomColor={C.border}>
          <TextInput
             value={filter}
             onChange={setFilter}
             placeholder="Search commands..."
          />
        </Box>
        <Box flexDirection="column" paddingY={1}>
          {items.map((item, i) => (
            <Box key={item.id} paddingX={1} backgroundColor={selectedIndex === i ? C.accent : undefined}>
              <Box width={15}>
                <Text color={selectedIndex === i ? C.bgDeep : C.dim} dimColor={selectedIndex !== i}>{item.group}</Text>
              </Box>
              <Text color={selectedIndex === i ? C.bgDeep : C.text}>{item.title}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
