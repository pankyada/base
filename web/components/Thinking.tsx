import { Spinner } from './Spinner'

interface Props {
  steps: string[]
  active: number
  done: boolean
}

export function Thinking({ steps, active, done }: Props) {
  return (
    <div className="thinking">
      {steps.map((step, i) => {
        const isDone = done || i < active
        const isActive = i === active && !done
        return (
          <div key={i} className={`thinking-step${isActive ? ' thinking-step--active' : ''}`}>
            <span className={isDone ? 'thinking-step__icon--ok' : isActive ? 'thinking-step__icon--active' : ''}>
              {isDone ? '✓' : isActive ? <Spinner /> : '·'}
            </span>
            <span>{step}</span>
          </div>
        )
      })}
    </div>
  )
}
