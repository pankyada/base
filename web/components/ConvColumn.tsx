import { ReactNode } from 'react'

interface Props {
  split: boolean
  title?: string
  children: ReactNode
}

export function ConvColumn({ split, title = 'conversation', children }: Props) {
  if (!split) {
    return <div className="col-conv" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>{children}</div>
  }

  return (
    <div className="col-conv">
      <div className="pane">
        <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--border-hi)' }}>┤</span>
          <span style={{ color: 'var(--accent)' }}> ● {title} </span>
          <span style={{ color: 'var(--border-hi)' }}>├</span>
        </div>
        <div className="pane-body" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
