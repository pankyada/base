interface Props {
  onSelect: (id: string) => void
}

const SUGGESTS = [
  { id: 'data',     icon: '▟',  label: 'Data Analysis', desc: 'Analyze Q2 revenue trends' },
  { id: 'coding',   icon: '❮❯', label: 'Coding',        desc: 'Fix the race condition in worker pool' },
  { id: 'writing',  icon: '✎',  label: 'Writing',       desc: 'Draft a launch announcement' },
  { id: 'research', icon: '◎',  label: 'Research',      desc: 'Map on-device LLM landscape' },
]

export function Hero({ onSelect }: Props) {
  return (
    <div style={{ padding: '2.5rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, justifyContent: 'center', gap: '2rem' }}>

      <div style={{ textAlign: 'center' }}>
        <pre style={{ color: 'var(--faint)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
{`  ┌─┐  agent control surface
  │◆│  data · code · writing · research
  └─┘`}
        </pre>
        <div style={{ color: 'var(--accent)', marginBottom: '0.3rem', fontSize: '0.95rem' }}>◆ harness</div>
        <div style={{ color: 'var(--dim)', fontSize: '0.8rem' }}>A harness for an agent that does the work in the open.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', width: '100%', maxWidth: '560px' }}>
        {SUGGESTS.map(s => (
          <div key={s.id} className="hero-card" onClick={() => onSelect(s.id)}>
            <span className="hero-card__icon">{s.icon}</span>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div className="hero-card__label">{s.label}</div>
              <div className="hero-card__desc">{s.desc}</div>
            </div>
            <span className="hero-card__arrow">↵</span>
          </div>
        ))}
      </div>

    </div>
  )
}
