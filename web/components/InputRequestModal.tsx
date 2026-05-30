'use client'
import { useState, useEffect, useRef } from 'react'
import type { InputRequestKind } from '../lib/types.js'

interface Props {
  id: string
  prompt: string
  kind: InputRequestKind
  options?: string[]
  onSubmit: (id: string, value: string) => void
}

export function InputRequestModal({ id, prompt, kind, options = [], onSubmit }: Props) {
  const [textValue, setTextValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (kind === 'text') inputRef.current?.focus()
  }, [kind])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (kind === 'text') return
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(options.length - 1, c + 1)) }
      if (e.key === ' ' && kind === 'multi_select') {
        e.preventDefault()
        setSelected(prev => {
          const next = new Set(prev)
          if (next.has(cursor)) next.delete(cursor)
          else next.add(cursor)
          return next
        })
      }
      if (e.key === 'Enter') {
        if (kind === 'select') onSubmit(id, options[cursor])
        else if (kind === 'multi_select') {
          const chosen = [...selected].sort((a, b) => a - b).map(i => options[i])
          onSubmit(id, chosen.join(', '))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [kind, cursor, selected, options, id, onSubmit])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ width: '520px', background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: '0.5rem', padding: '1.25rem' }}>
        <div style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '0.75rem' }}>Agent Question</div>
        <div style={{ marginBottom: '1rem', color: 'var(--fg)' }}>{prompt}</div>

        {kind === 'text' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={inputRef}
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && textValue.trim()) onSubmit(id, textValue.trim()) }}
              placeholder="Type your answer..."
              style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)', padding: '0.5rem', borderRadius: '0.25rem' }}
            />
            <button
              onClick={() => textValue.trim() && onSubmit(id, textValue.trim())}
              style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer', borderRadius: '0.25rem' }}
            >
              Submit
            </button>
          </div>
        )}

        {(kind === 'select' || kind === 'multi_select') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {options.map((opt, i) => {
              const isActive = i === cursor
              const isSelected = selected.has(i)
              return (
                <div
                  key={i}
                  onClick={() => {
                    setCursor(i)
                    if (kind === 'select') {
                      onSubmit(id, opt)
                    } else {
                      setSelected(prev => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i)
                        else next.add(i)
                        return next
                      })
                    }
                  }}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: isActive ? 'var(--panel-hover, rgba(255,255,255,0.05))' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '0.25rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: 'var(--fg)',
                  }}
                >
                  <span style={{ color: isSelected || (kind === 'select' && isActive) ? 'var(--accent)' : 'var(--dim)' }}>
                    {kind === 'multi_select' ? (isSelected ? '◉' : '○') : (isActive ? '▶' : ' ')}
                  </span>
                  {opt}
                </div>
              )
            })}
            {kind === 'multi_select' && (
              <button
                onClick={() => {
                  const chosen = [...selected].sort((a, b) => a - b).map(i => options[i])
                  onSubmit(id, chosen.join(', '))
                }}
                style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer', borderRadius: '0.25rem' }}
              >
                Confirm selection
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
