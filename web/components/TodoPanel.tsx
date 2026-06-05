'use client'
import { useState } from 'react'
import type { TodoItem } from '../lib/types'

interface Props {
  todos: TodoItem[]
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
}

const STATUS_COLOR: Record<TodoItem['status'], string> = {
  pending: 'var(--dim)',
  in_progress: 'var(--accent)',
  completed: 'var(--ok)',
}

export function TodoPanel({ todos }: Props) {
  const [open, setOpen] = useState(true)
  if (todos.length === 0) return null

  const inProgress = todos.filter(t => t.status === 'in_progress').length
  const done = todos.filter(t => t.status === 'completed').length

  return (
    <div style={{
      position: 'fixed',
      right: '1rem',
      bottom: '2.5rem',
      width: '240px',
      zIndex: 40,
      fontFamily: 'inherit',
      fontSize: '12px',
    }}>
      {/* Header / toggle */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'var(--panel-hi)',
          border: '1px solid var(--border)',
          borderBottom: open ? '1px solid var(--border)' : '1px solid var(--border)',
          borderRadius: open ? '4px 4px 0 0' : '4px',
          padding: '0.35rem 0.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ color: 'var(--accent)', fontSize: '10px' }}>◈</span>
        <span style={{ color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '0.65rem', flexGrow: 1 }}>
          tasks
        </span>
        {inProgress > 0 && (
          <span style={{ background: 'var(--accent-sub)', color: 'var(--accent)', padding: '0 4px', borderRadius: '3px', fontSize: '0.65rem' }}>
            {inProgress} active
          </span>
        )}
        <span style={{ color: 'var(--faint)', fontSize: '10px' }}>{open ? '▾' : '▸'}</span>
      </div>

      {/* Body */}
      {open && (
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 4px 4px',
          padding: '0.4rem 0.6rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
          maxHeight: '240px',
          overflowY: 'auto',
        }}>
          {todos.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
              <span style={{ color: STATUS_COLOR[item.status], flexShrink: 0, marginTop: '1px' }}>
                {STATUS_ICON[item.status]}
              </span>
              <span style={{
                color: item.status === 'completed' ? 'var(--faint)' : 'var(--text)',
                textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                lineHeight: 1.4,
                flex: 1,
              }}>
                {item.content}
              </span>
              <span style={{
                color: item.priority === 'high' ? 'var(--del)' : item.priority === 'medium' ? 'var(--warn)' : 'var(--faint)',
                flexShrink: 0,
                fontSize: '0.65rem',
                marginTop: '1px',
                opacity: 0.75,
              }}>
                {item.priority[0]}
              </span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.25rem', paddingTop: '0.25rem', color: 'var(--faint)', fontSize: '0.65rem' }}>
            {done}/{todos.length} done
          </div>
        </div>
      )}
    </div>
  )
}
