'use client'
import { useEffect, useState } from 'react'
import { Brief } from '../../components/assistant/Brief'
import { Shell } from '../../components/chrome/Shell'
import { MemoryTimeline, memoryEditPrompt } from '../../components/assistant/MemoryTimeline'
import { TriggerList } from '../../components/assistant/TriggerList'
export default function HomePage() {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [memoryAt, setMemoryAt] = useState<string>()
  const base = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'
  useEffect(() => {
    const at = new URLSearchParams(window.location.search).get('at') ?? undefined
    setMemoryAt(at)
    const memoryPath = at ? `/memory?at=${encodeURIComponent(at)}` : '/memory'
    void Promise.all(['/pending', '/runs', '/usage', '/triggers', memoryPath, '/metrics'].map(path => fetch(`${base}${path}`).then(response => response.ok ? response.json() : {}))).then(([pending, runs, usage, triggers, memory, metrics]) => setData({ pending, runs, usage, triggers, memory, metrics })).catch(() => setData({}))
  }, [base])
  const memoryEntries = (data.memory as { entries?: { key?: string; content?: string; valid_from?: string; valid_to?: string; superseded?: boolean }[] } | undefined)?.entries ?? []
  const triggers = (data.triggers as { triggers?: { name: string; kind: string; fires: number; skips: number; skip_reasons?: Record<string, number>; last_fire?: string | null }[] } | undefined)?.triggers ?? []
  return <Shell><main className="route-page"><Brief data={data} /><section className="memory-filter"><label>Memory instant <input type="datetime-local" value={memoryAt ? memoryAt.slice(0, 16) : ''} onChange={event => { const value = event.target.value ? new Date(event.target.value).toISOString() : ''; window.location.href = value ? `/home?at=${encodeURIComponent(value)}` : '/home' }} /></label></section><MemoryTimeline entries={memoryEntries} onEdit={entry => { window.localStorage.setItem('harness-composer-draft', memoryEditPrompt(entry)); window.location.href = '/' }} /><TriggerList triggers={triggers} /></main></Shell>
}
