import { useState, useEffect } from 'react'
import { theme } from '../theme.js'

// Breathing cycle: dotted → hollow → filled → hollow → dotted
const ORB_CHARS = ['◌', '○', '◉', '●', '◉', '○']
const ORB_INTERVAL_MS = 250 // 6 frames × 250ms = 1.5s cycle

export function orbColorFromCost(costUsd: number): string {
  if (costUsd < 0.01) return theme.orbGreen
  if (costUsd < 0.10) return theme.orbYellow
  return theme.orbRed
}

export function useOrb(generating: boolean, costUsd: number) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!generating) {
      setFrame(0)
      return
    }
    const id = setInterval(() => setFrame(f => (f + 1) % ORB_CHARS.length), ORB_INTERVAL_MS)
    return () => clearInterval(id)
  }, [generating])

  const char = generating ? ORB_CHARS[frame] : '●'
  const color = generating ? orbColorFromCost(costUsd) : theme.dim

  return { char, color }
}
