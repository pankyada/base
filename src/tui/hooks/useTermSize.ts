import { useState, useEffect } from 'react'
export function useTermSize() {
  const get = () => ({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 })
  const [size, setSize] = useState(get)
  useEffect(() => {
    const h = () => setSize(get())
    process.stdout.on('resize', h)
    return () => { process.stdout.off('resize', h) }
  }, [])
  return size
}
