import { useState, useEffect } from 'react'
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export function useSpinner() {
  const [f, setF] = useState(0)
  useEffect(() => { const id = setInterval(() => setF(x => (x + 1) % FRAMES.length), 80); return () => clearInterval(id) }, [])
  return FRAMES[f]
}
