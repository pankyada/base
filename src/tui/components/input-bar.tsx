import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ClientMessage } from '../../types.js'
import { theme } from '../theme.js'

interface InputBarProps {
  onSend: (msg: ClientMessage) => void
  onClear: () => void
  onScroll: (delta: number) => void
  pendingToolId: string | null
  disabled: boolean
}

const HISTORY_MAX = 50

export function InputBar({ onSend, onClear, onScroll, pendingToolId, disabled }: InputBarProps) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend({ type: 'message', content: trimmed })
    setHistory(prev => [trimmed, ...prev].slice(0, HISTORY_MAX))
    setHistIdx(-1)
    setValue('')
  }, [value, onSend])

  useInput((input, key) => {
    if (disabled && !pendingToolId) return

    // Tool prompt keys
    if (pendingToolId) {
      if (input === 'y' || input === 'Y') {
        onSend({ type: 'tool_approve', id: pendingToolId })
        return
      }
      if (input === 'n' || input === 'N' || key.escape) {
        onSend({ type: 'tool_deny', id: pendingToolId })
        return
      }
      return
    }

    if (key.ctrl && input === 'c') {
      onSend({ type: 'cancel' })
      return
    }

    if (key.ctrl && input === 'l') {
      onClear()
      setValue('')
      return
    }

    if (key.upArrow) {
      const nextIdx = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(nextIdx)
      setValue(history[nextIdx] ?? '')
      return
    }

    if (key.downArrow) {
      const nextIdx = Math.max(histIdx - 1, -1)
      setHistIdx(nextIdx)
      setValue(nextIdx === -1 ? '' : history[nextIdx] ?? '')
      return
    }

    if (key.return) {
      submit()
      return
    }

    if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1))
      return
    }

    if (input && !key.ctrl && !key.meta) {
      setValue(v => v + input)
    }
  })

  const prompt = pendingToolId ? '⚠ y/n ❯ ' : disabled ? '… ❯ ' : '❯ '

  return (
    <Box borderStyle="single" borderColor={theme.border} paddingX={1}>
      <Text color={theme.accent}>{prompt}</Text>
      <Text>{value}</Text>
      <Text color={theme.dim}>▌</Text>
    </Box>
  )
}
