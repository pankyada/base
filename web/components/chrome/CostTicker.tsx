interface Props { costUsd?: number; tokensIn?: number; tokensOut?: number }

export function CostTicker({ costUsd = 0, tokensIn = 0, tokensOut = 0 }: Props) {
  return <span className="cost-ticker" title={`${tokensIn} input / ${tokensOut} output tokens`}>${costUsd.toFixed(2)}</span>
}
