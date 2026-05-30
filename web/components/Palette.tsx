import { useState, useEffect, KeyboardEvent } from 'react'

interface Props {
  onClose: () => void
  onRun: (id: string) => void
  onReset: () => void
}

const RUN_SCENARIOS = [
  { id: 'data', title: 'Run Data Analysis' },
  { id: 'coding', title: 'Run Coding Task' },
  { id: 'writing', title: 'Run Writing Task' },
  { id: 'research', title: 'Run Research Task' }
]

const SESSION_ACTIONS = [
  { id: 'reset', title: 'Clear Session' }
]

export function Palette({ onClose, onRun, onReset }: Props) {
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const items = [
    ...RUN_SCENARIOS.filter(s => s.title.toLowerCase().includes(filter.toLowerCase())).map(s => ({ ...s, group: 'RUN TASK' })),
    ...SESSION_ACTIONS.filter(s => s.title.toLowerCase().includes(filter.toLowerCase())).map(s => ({ ...s, group: 'SESSION' }))
  ]

  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowDown') setSelectedIndex(i => Math.min(i + 1, items.length - 1))
    if (e.key === 'ArrowUp') setSelectedIndex(i => Math.max(i - 1, 0))
    if (e.key === 'Enter' && items.length > 0) {
      const item = items[selectedIndex]
      if (item.id === 'reset') onReset()
      else onRun(item.id)
      onClose()
    }
  }

  return (
    <div className="palette-scrim" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', paddingTop: '10vh', zIndex: 100 }}>
      <div className="palette" style={{ width: '600px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '50vh' }}>
        <input
          autoFocus
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search commands..."
          style={{ padding: '1rem', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
        />
        <div style={{ overflowY: 'auto' }}>
          {items.map((item, i) => (
            <div
              key={item.id}
              style={{
                padding: '0.5rem 1rem',
                background: selectedIndex === i ? 'var(--accent)' : 'transparent',
                color: selectedIndex === i ? 'var(--bg)' : 'var(--text)',
                cursor: 'pointer'
              }}
              onClick={() => {
                if (item.id === 'reset') onReset()
                else onRun(item.id)
                onClose()
              }}
            >
              <span style={{ fontSize: '0.75rem', opacity: 0.7, marginRight: '1rem' }}>{item.group}</span>
              {item.title}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
