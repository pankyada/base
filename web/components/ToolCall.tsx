import { useState } from 'react'

interface Props {
  tool: { type: string; arg: string; out: string; done: boolean }
  running: boolean
}

export function ToolCall({ tool, running }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ margin: '0.25rem 0', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
      <div style={{ display: 'flex', gap: '0.5rem', color: running ? 'var(--accent)' : 'var(--dim)' }}>
        <span style={{ minWidth: '80px' }}>{tool.type}</span>
        <span style={{ flexGrow: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{tool.arg}</span>
        <span>{tool.done ? '✓' : '...'}</span>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      {open && tool.out && (
        <pre style={{ margin: '0.25rem 0 0.25rem 2rem', padding: '0.5rem', background: 'var(--bg-deep)', borderLeft: '2px solid var(--border)', overflowX: 'auto', color: 'var(--dim)' }}>
          {tool.out}
        </pre>
      )}
    </div>
  )
}
