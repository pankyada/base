interface Props {
  role: 'user' | 'agent'
  time: string
  children: React.ReactNode
}

export function Message({ role, time, children }: Props) {
  return (
    <div style={{ padding: '1rem', borderLeft: role === 'user' ? '2px solid var(--info)' : 'none', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--dim)', marginBottom: '0.5rem' }}>
        {role === 'user' ? 'YOU › ' : 'HARNESS ◆ '} {time}
      </div>
      <div>{children}</div>
    </div>
  )
}
