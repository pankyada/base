import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { C } from '../theme.js'
import type { InputRequestKind } from '../../types.js'

interface Props {
  id: string
  prompt: string
  kind: InputRequestKind
  options?: string[]
  onSubmit: (id: string, value: string) => void
}

export function InputRequestModal({ id, prompt, kind, options = [], onSubmit }: Props) {
  const [textValue, setTextValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useInput((input, key) => {
    if (kind === 'text') return // TextInput handles its own input

    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(options.length - 1, c + 1))

    if (kind === 'multi_select' && input === ' ') {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(cursor)) next.delete(cursor)
        else next.add(cursor)
        return next
      })
    }

    if (key.return) {
      if (kind === 'select') {
        onSubmit(id, options[cursor])
      } else if (kind === 'multi_select') {
        const chosen = [...selected].sort().map(i => options[i])
        onSubmit(id, chosen.join(', '))
      }
    }
  })

  return (
    <Box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        width={62}
        flexDirection="column"
        borderStyle="single"
        borderColor={C.accent}
        padding={1}
      >
        <Text color={C.accent} bold>Agent Question</Text>
        <Box marginTop={1} marginBottom={1}>
          <Text>{prompt}</Text>
        </Box>

        {kind === 'text' && (
          <Box>
            <Text color={C.dim}>› </Text>
            <TextInput
              value={textValue}
              onChange={setTextValue}
              onSubmit={v => onSubmit(id, v)}
              placeholder="Type your answer..."
            />
          </Box>
        )}

        {(kind === 'select' || kind === 'multi_select') && (
          <Box flexDirection="column">
            {options.map((opt, i) => {
              const isActive = i === cursor
              const isSelected = selected.has(i)
              const prefix = kind === 'multi_select'
                ? (isSelected ? '◉ ' : '○ ')
                : (isActive ? '▶ ' : '  ')
              return (
                <Box key={i}>
                  <Text
                    color={isActive ? C.accent : C.text}
                    bold={isActive}
                  >
                    {prefix}{opt}
                  </Text>
                </Box>
              )
            })}
            <Box marginTop={1}>
              <Text color={C.dim}>
                {kind === 'multi_select'
                  ? '↑↓ navigate  Space toggle  Enter confirm'
                  : '↑↓ navigate  Enter select'}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
