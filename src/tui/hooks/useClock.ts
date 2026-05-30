import { useState, useEffect } from 'react'
export function useClock() {
  const fmt = () => new Date().toLocaleTimeString('en-US', { hour12: false })
  const [t, setT] = useState(fmt)
  useEffect(() => { const id = setInterval(() => setT(fmt()), 1000); return () => clearInterval(id) }, [])
  return t
}
