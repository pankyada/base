'use client'
import { useState, useEffect } from 'react'
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export function Spinner() {
  const [f, setF] = useState(0)
  useEffect(() => { const id = setInterval(() => setF(x => (x + 1) % FRAMES.length), 80); return () => clearInterval(id) }, [])
  return <span className="spin">{FRAMES[f]}</span>
}
