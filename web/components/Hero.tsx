interface Props {
  onSelect: (id: string) => void
}

const SUGGESTS = [
  { id: 'data', icon: '▟', title: 'DATA ANALYSIS', desc: 'Analyze Q2 revenue...' },
  { id: 'coding', icon: '❮❯', title: 'CODING', desc: 'Fix the race cond...' },
  { id: 'writing', icon: '✎', title: 'WRITING', desc: 'Draft a launch ann...' },
  { id: 'research', icon: '◎', title: 'RESEARCH', desc: 'Map on-device LLM...' }
]

export function Hero({ onSelect }: Props) {
  return (
    <div className="hero" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, justifyContent: 'center' }}>
      <pre style={{ color: 'var(--dim)', marginBottom: '2rem', textAlign: 'center' }}>
{`  ┌─┐  agent control surface
  │◆│  data · code · writing · research
  └─┘`}
      </pre>
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--accent)', fontWeight: 'bold' }}>◆ harness</div>
        <div style={{ color: 'var(--dim)' }}>A harness for an agent that does the work in the open.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', width: '100%', maxWidth: '600px' }}>
        {SUGGESTS.map(s => (
          <div key={s.id} onClick={() => onSelect(s.id)} style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '0.25rem', cursor: 'pointer', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--accent)', width: '24px', textAlign: 'center' }}>{s.icon}</span>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--dim)', fontWeight: 'bold' }}>{s.title}</div>
              <div>{s.desc}</div>
            </div>
            <span style={{ color: 'var(--faint)' }}>↵</span>
          </div>
        ))}
      </div>
    </div>
  )
}
