import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'
import type { TodoItem } from '../../types.js'

interface Props {
  todos: TodoItem[]
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
}

const STATUS_COLOR: Record<TodoItem['status'], string> = {
  pending: C.dim,
  in_progress: C.accent,
  completed: C.ok,
}

const PRIORITY_COLOR: Record<TodoItem['priority'], string> = {
  high: C.del,
  medium: C.info,
  low: C.dim,
}

export function TodoPanel({ todos }: Props) {
  if (todos.length === 0) return null

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={C.border}
      paddingX={1}
      paddingY={0}
      marginTop={1}
    >
      <Text color={C.dim} bold>Tasks</Text>
      {todos.map(item => (
        <Box key={item.id} marginTop={0}>
          <Text color={STATUS_COLOR[item.status]}>
            {STATUS_ICON[item.status]}{' '}
          </Text>
          <Text
            color={item.status === 'completed' ? C.dim : C.text}
            strikethrough={item.status === 'completed'}
          >
            {item.content}
          </Text>
          <Text color={PRIORITY_COLOR[item.priority]}>
            {' '}[{item.priority}]
          </Text>
        </Box>
      ))}
    </Box>
  )
}
