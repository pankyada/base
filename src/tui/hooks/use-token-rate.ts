import { useState, useEffect, useRef, useCallback } from 'react'

const BUCKETS = 8
const BUCKET_MS = 250
const GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function bucketsToBarString(buckets: number[]): string {
  const max = Math.max(...buckets, 1)
  return buckets.map(b => GLYPHS[Math.min(7, Math.floor((b / max) * 7))]).join('')
}

export function bucketsToRate(buckets: number[]): number {
  const total = buckets.reduce((a, b) => a + b, 0)
  return Math.round(total / (BUCKETS * BUCKET_MS / 1000))
}

export function useTokenRate(generating: boolean) {
  const [buckets, setBuckets] = useState<number[]>(Array(BUCKETS).fill(0))
  const pendingRef = useRef(0)

  const addToken = useCallback(() => {
    pendingRef.current++
  }, [])

  useEffect(() => {
    if (!generating) {
      setBuckets(Array(BUCKETS).fill(0))
      pendingRef.current = 0
      return
    }
    const id = setInterval(() => {
      const count = pendingRef.current
      pendingRef.current = 0
      setBuckets(prev => [...prev.slice(1), count])
    }, BUCKET_MS)
    return () => clearInterval(id)
  }, [generating])

  return {
    bars: bucketsToBarString(buckets),
    rate: bucketsToRate(buckets),
    addToken,
  }
}
