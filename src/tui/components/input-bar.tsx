import React, { useReducer, useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ClientMessage } from '../../types.js'
import { theme } from '../theme.js'

interface InputBarProps {
  onSend: (msg: ClientMessage) => void
  onClear: () => void
  onScroll: (delta: number) => void
  onExpandLast: () => void
  pendingToolId: string | null
  disabled: boolean
}

// ── Input state machine ────────────────────────────────────────────────────

interface InputState {
  lines: string[]
  lineIdx: number
  colIdx: number
}

type InputAction =
  | { type: 'insert'; char: string }
  | { type: 'backspace' }
  | { type: 'newline' }
  | { type: 'moveLeft' }
  | { type: 'moveRight' }
  | { type: 'moveUp'; clamp?: boolean }
  | { type: 'moveDown'; clamp?: boolean }
  | { type: 'reset' }
  | { type: 'setLines'; lines: string[] }

export function inputReducer(state: InputState, action: InputAction): InputState {
  const { lines, lineIdx, colIdx } = state

  switch (action.type) {
    case 'insert': {
      const cur = lines[lineIdx]
      const newLine = cur.slice(0, colIdx) + action.char + cur.slice(colIdx)
      const next = [...lines]
      next[lineIdx] = newLine
      return { ...state, lines: next, colIdx: colIdx + 1 }
    }
    case 'backspace': {
      if (colIdx > 0) {
        const cur = lines[lineIdx]
        const next = [...lines]
        next[lineIdx] = cur.slice(0, colIdx - 1) + cur.slice(colIdx)
        return { ...state, lines: next, colIdx: colIdx - 1 }
      }
      if (lineIdx > 0) {
        const prevLen = lines[lineIdx - 1].length
        const merged = lines[lineIdx - 1] + lines[lineIdx]
        const next = [...lines.slice(0, lineIdx - 1), merged, ...lines.slice(lineIdx + 1)]
        return { lines: next, lineIdx: lineIdx - 1, colIdx: prevLen }
      }
      return state
    }
    case 'newline': {
      const cur = lines[lineIdx]
      const before = cur.slice(0, colIdx)
      const after = cur.slice(colIdx)
      const next = [...lines.slice(0, lineIdx), before, after, ...lines.slice(lineIdx + 1)]
      return { lines: next, lineIdx: lineIdx + 1, colIdx: 0 }
    }
    case 'moveLeft': {
      if (colIdx > 0) return { ...state, colIdx: colIdx - 1 }
      if (lineIdx > 0) return { ...state, lineIdx: lineIdx - 1, colIdx: lines[lineIdx - 1].length }
      return state
    }
    case 'moveRight': {
      if (colIdx < lines[lineIdx].length) return { ...state, colIdx: colIdx + 1 }
      if (lineIdx < lines.length - 1) return { ...state, lineIdx: lineIdx + 1, colIdx: 0 }
      return state
    }
    case 'moveUp': {
      if (lineIdx > 0) {
        const newLineIdx = lineIdx - 1
        return { ...state, lineIdx: newLineIdx, colIdx: Math.min(colIdx, lines[newLineIdx].length) }
      }
      // Signal to caller: at top, should navigate history
      return action.clamp ? state : { ...state, lineIdx: -1 } // sentinel
    }
    case 'moveDown': {
      if (lineIdx < lines.length - 1) {
        const newLineIdx = lineIdx + 1
        return { ...state, lineIdx: newLineIdx, colIdx: Math.min(colIdx, lines[newLineIdx].length) }
      }
      // Signal to caller: at bottom, should navigate history
      return action.clamp ? state : { ...state, lineIdx: lines.length } // sentinel
    }
    case 'reset':
      return { lines: [''], lineIdx: 0, colIdx: 0 }
    case 'setLines': {
      const l = action.lines.length > 0 ? action.lines : ['']
      return { lines: l, lineIdx: 0, colIdx: l[0].length }
    }
    default:
      return state
  }
}

const HISTORY_MAX = 50

// ── Component ──────────────────────────────────────────────────────────────

export function InputBar({ onSend, onClear, onScroll, onExpandLast, pendingToolId, disabled }: InputBarProps) {
  const [inputState, dispatchInput] = useReducer(inputReducer, {
    lines: [''], lineIdx: 0, colIdx: 0,
  })
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)

  const submit = useCallback((lines: string[]) => {
    const text = lines.join('\n').trim()
    if (!text) return
    onSend({ type: 'message', content: text })
    setHistory(prev => [text, ...prev].slice(0, HISTORY_MAX))
    setHistIdx(-1)
    dispatchInput({ type: 'reset' })
  }, [onSend])

  useInput((input, key) => {
    if (disabled && !pendingToolId) return

    // ── Tool approval ──────────────────────────────────────────────────────
    if (pendingToolId) {
      if (input === 'y' || input === 'Y') { onSend({ type: 'tool_approve', id: pendingToolId }); return }
      if (input === 'n' || input === 'N' || key.escape) { onSend({ type: 'tool_deny', id: pendingToolId }); return }
      return
    }

    // ── Control keys ───────────────────────────────────────────────────────
    if (key.ctrl && input === 'c') { onSend({ type: 'cancel' }); return }
    if (key.ctrl && input === 'l') { onClear(); dispatchInput({ type: 'reset' }); setHistIdx(-1); return }
    if (key.ctrl && input === 'e') { onExpandLast(); return }

    // ── Scroll passthrough ─────────────────────────────────────────────────
    if (key.pageUp)   { onScroll(-5); return }
    if (key.pageDown) { onScroll(5);  return }

    // ── Newline (Shift+Enter or Alt+Enter) ─────────────────────────────────
    if (key.return && (key.shift || key.meta)) {
      dispatchInput({ type: 'newline' })
      return
    }

    // ── Submit ─────────────────────────────────────────────────────────────
    if (key.return) {
      submit(inputState.lines)
      return
    }

    // ── Cursor movement ────────────────────────────────────────────────────
    if (key.leftArrow)  { dispatchInput({ type: 'moveLeft'  }); return }
    if (key.rightArrow) { dispatchInput({ type: 'moveRight' }); return }

    if (key.upArrow) {
      const next = inputReducer(inputState, { type: 'moveUp' })
      if (next.lineIdx < 0) {
        // At top of input — navigate history
        const nextHistIdx = Math.min(histIdx + 1, history.length - 1)
        if (nextHistIdx !== histIdx && history[nextHistIdx] !== undefined) {
          setHistIdx(nextHistIdx)
          dispatchInput({ type: 'setLines', lines: history[nextHistIdx].split('\n') })
        }
      } else {
        dispatchInput({ type: 'moveUp', clamp: true })
      }
      return
    }

    if (key.downArrow) {
      const next = inputReducer(inputState, { type: 'moveDown' })
      if (next.lineIdx >= inputState.lines.length) {
        // At bottom of input — navigate history
        const nextHistIdx = histIdx - 1
        setHistIdx(nextHistIdx)
        if (nextHistIdx < 0) {
          dispatchInput({ type: 'reset' })
        } else if (history[nextHistIdx] !== undefined) {
          dispatchInput({ type: 'setLines', lines: history[nextHistIdx].split('\n') })
        }
      } else {
        dispatchInput({ type: 'moveDown', clamp: true })
      }
      return
    }

    // ── Backspace ──────────────────────────────────────────────────────────
    if (key.backspace || key.delete) {
      dispatchInput({ type: 'backspace' })
      return
    }

    // ── Printable character ────────────────────────────────────────────────
    if (input && !key.ctrl && !key.meta) {
      dispatchInput({ type: 'insert', char: input })
    }
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  // Tool approval or generating-idle prompt
  if (pendingToolId) {
    return (
      <Box borderStyle="single" borderColor={theme.warn} paddingX={1}>
        <Text color={theme.warn}>⚠ y/n ❯ </Text>
      </Box>
    )
  }

  if (disabled) {
    return (
      <Box borderStyle="single" borderColor={theme.border} paddingX={1}>
        <Text color={theme.dim}>… ❯ </Text>
      </Box>
    )
  }

  const { lines, lineIdx, colIdx } = inputState

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
      {lines.map((line, i) => {
        const isActive = i === lineIdx
        const prefix = i === 0
          ? <Text color={theme.accent}>❯ </Text>
          : <Text color={theme.dim}>{'  '}</Text>

        if (isActive) {
          const before = line.slice(0, colIdx)
          const cursorChar = line[colIdx] ?? ' '
          const after = line.slice(colIdx + 1)
          return (
            <Box key={i}>
              {prefix}
              <Text>{before}</Text>
              <Text inverse>{cursorChar}</Text>
              <Text>{after}</Text>
            </Box>
          )
        }

        return (
          <Box key={i}>
            {prefix}
            <Text>{line}</Text>
          </Box>
        )
      })}
      {lines.length > 1 && (
        <Text color={theme.dim}>  {lines.length} lines · ⇧↵ newline</Text>
      )}
    </Box>
  )
}
