interface Props {
  role: 'user' | 'agent'
  time: string
  children: React.ReactNode
}

export function Message({ role, time, children }: Props) {
  return (
    <div className={`msg-row msg-row--${role}`}>
      <div className="msg-meta">
        <span className={`role-label role-label--${role}`}>
          {role === 'user' ? 'YOU ›' : 'HARNESS ◆'}
        </span>
        {' '}{time}
      </div>
      <div>{children}</div>
    </div>
  )
}
