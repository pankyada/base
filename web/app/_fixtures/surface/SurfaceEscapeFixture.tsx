'use client'

import { useEffect, useMemo, useState } from 'react'
import corpus from '../../../surface/escape-corpus.json'
import { SurfaceHost } from '../../../surface/SurfaceHost'

export function SurfaceEscapeFixture() {
  const [results, setResults] = useState<Record<string, { blocked: boolean }>>({})
  const [armed, setArmed] = useState(false)
  const surfaces = useMemo(() => corpus.map((payload, index) => ({
    id: 'escape-' + index,
    mode: 'replace' as const,
    html: '<p>isolated surface</p>',
    js: '(async function(){var blocked=false;try{await Promise.resolve(' + payload + ')}catch(_error){blocked=true}window.emit("escape_result",{blocked:blocked,index:' + index + '})})()'
  })), [])
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; name?: unknown; payload?: unknown }
      if (message?.type !== 'emit' || message.name !== 'escape_result' || !message.payload || typeof message.payload !== 'object') return
      const payload = message.payload as { index?: unknown; blocked?: unknown }
      if (typeof payload.index !== 'number') return
      setResults(current => ({ ...current, [String(payload.index)]: { blocked: payload.blocked === true } }))
    }
    window.addEventListener('message', onMessage)
    setArmed(true)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return <main style={{ padding: 24 }}>
    <h1>Surface escape corpus</h1>
    <p id="corpus-status">{Object.keys(results).length}/{corpus.length} tested</p>
    {armed ? surfaces.map((surface, index) => <section key={surface.id} data-testid={'escape-' + index}>
      <h2>{index}: {corpus[index]}</h2>
      <SurfaceHost
        surface={surface}
        onResult={() => undefined}
        onEmit={(name, payloadValue) => {
          if (name !== 'escape_result' || !payloadValue || typeof payloadValue !== 'object') return
          const value = payloadValue as { blocked?: unknown }
          setResults(current => ({ ...current, [String(index)]: { blocked: value.blocked === true } }))
        }}
      />
      <output data-testid={'result-' + index}>{results[String(index)]?.blocked === true ? 'blocked' : results[String(index)] ? 'escaped' : 'pending'}</output>
    </section>) : <p>arming browser corpus…</p>}
  </main>
}
