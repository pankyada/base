'use client'
import type { TodoItem } from '../lib/types.js'

interface Props {
  todos: TodoItem[]
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
}

export function TodoPanel({ todos }: Props) {
  if (todos.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ color: 'var(--dim)', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Tasks</div>
      {todos.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: item.status === 'completed' ? 'var(--ok)' : item.status === 'in_progress' ? 'var(--accent)' : 'var(--dim)', fontSize: '0.85rem' }}>
            {STATUS_ICON[item.status]}
          </span>
          <span style={{
            color: item.status === 'completed' ? 'var(--dim)' : 'var(--fg)',
            textDecoration: item.status === 'completed' ? 'line-through' : 'none',
            fontSize: '0.875rem',
            flex: 1,
          }}>
            {item.content}
          </span>
          <span style={{
            fontSize: '0.7rem',
            color: item.priority === 'high' ? 'var(--del)' : item.priority === 'medium' ? 'var(--warn)' : 'var(--dim)',
            opacity: 0.8,
          }}>
            {item.priority}
          </span>
        </div>
      ))}
    </div>
  )
}
