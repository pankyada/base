'use client'
// One rendering of the "failed" RemoteData state, shared by every surface converted in sprint C4 --
// an explicit reason plus a retry control, instead of each component inventing its own error banner.
export function Unavailable({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return <p role="alert" className="unavailable-state">Unavailable: {reason}{onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}</p>
}
