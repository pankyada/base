import { Spinner } from './Spinner.js'

interface Props {
  steps: string[]
  active: number
  done: boolean
}

export function Thinking({ steps, active, done }: Props) {
  return (
    <div style={{ border: '1px dashed var(--border)', padding: '0.5rem', margin: '0.5rem 0', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {steps.map((step, i) => (
        <div key={i} style={{ color: i === active && !done ? 'var(--text)' : 'var(--dim)', display: 'flex', gap: '0.5rem' }}>
          <span>{done || i < active ? '✓' : i === active ? <Spinner /> : '·'}</span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  )
}
