import type { UsageMetadataWire } from '../../lib/protocol'

interface Props { costUsd?: number; tokensIn?: number; tokensOut?: number; usage?: UsageMetadataWire }

export function costBasisLabel(usage?: UsageMetadataWire): string | undefined {
  if (!usage?.cost_basis) return undefined
  if (usage.cost_basis === 'api_equivalent' && usage.billing_mode === 'subscription') return 'Codex · API-equivalent est.'
  if (usage.cost_basis === 'api_equivalent') return 'API-equivalent est.'
  if (usage.cost_basis === 'api_estimate') return 'API est.'
  if (usage.cost_basis === 'mixed') return 'Mixed est.'
  return undefined
}

export function CostTicker({ costUsd = 0, tokensIn = 0, tokensOut = 0, usage }: Props) {
  const label = costBasisLabel(usage)
  return <span className="cost-ticker" title={`${tokensIn} input / ${tokensOut} output tokens`}>${costUsd.toFixed(2)}{label ? <small> {label}</small> : null}</span>
}
