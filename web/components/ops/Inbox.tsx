'use client'
import { useEffect, useState } from 'react'

export function pendingLabel(expiresAt: string, now = Date.now()): string { const remaining = Math.ceil((new Date(expiresAt).getTime() - now) / 1000); return remaining <= 0 ? 'expired' : remaining + 's remaining' }
export function Inbox({ items = [], onAnswer }: { items?: { id: string; prompt: string; expires_at: string }[]; onAnswer?: (id: string, value: string) => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  return <section className="inbox"><h2>Inbox</h2>{items.length === 0 ? <p>Nothing waiting for input.</p> : items.map(item => <article key={item.id}><strong>{item.prompt}</strong><span>{pendingLabel(item.expires_at, now)}</span><input aria-label={'Answer ' + item.id} onKeyDown={event => { if (event.key === 'Enter') onAnswer?.(item.id, event.currentTarget.value) }} /></article>)}</section>
}
