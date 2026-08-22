import type { RiskLevel } from '../../lib/types'
export interface ApprovalItem { id: string; name: string; input: unknown; risk?: RiskLevel; reason?: string }
export function approvalSummary(item: ApprovalItem): string { return `${item.risk ?? 'caution'} · ${item.reason ?? 'Agent requests tool approval'}` }
export function requiresDangerConfirmation(risk?: RiskLevel): boolean { return risk === 'danger' }
export function ApprovalQueue({ items, onApprove, onDeny }: { items: ApprovalItem[]; onApprove: (id: string) => void; onDeny: (id: string) => void }) {
  return <section className="approval-queue"><h2>Approval queue</h2>{items.map(item => <article key={item.id} className={`approval approval--${item.risk ?? 'caution'}`}><strong>{item.name}</strong><p>{approvalSummary(item)}</p><pre>{JSON.stringify(item.input, null, 2)}</pre><button onClick={() => onDeny(item.id)}>deny</button><button onClick={() => onApprove(item.id)}>allow</button></article>)}</section>
}
