import type { StageView } from '../../lib/reducer'

export function stageLabel(stage: StageView): string {
  const cost = stage.costUsd == null ? '' : ` · $${stage.costUsd.toFixed(2)}`
  const escalation = stage.state === 'escalated' ? ' · escalated' : ''
  return `${stage.stage} · I${stage.intensity} · ${stage.tier}${cost}${escalation}`
}

export function StageStrip({ stages = [] }: { stages?: StageView[] }) {
  if (!stages.length) return null
  return <div className="stage-strip" aria-label="Workflow stages">{stages.map((stage, index) => <span className={`stage-strip__item stage-strip__item--${stage.state}`} key={`${stage.stage}-${index}`}>{stageLabel(stage)}</span>)}</div>
}
