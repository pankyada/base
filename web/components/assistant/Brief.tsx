export interface BriefCard { id: string; title: string; empty: string; value?: unknown }
export function briefCards(data: Record<string, unknown>): BriefCard[] { return [{ id: 'waiting', title: 'Waiting on you', empty: 'Nothing is waiting on you', value: data.pending }, { id: 'runs', title: 'Overnight runs', empty: 'No overnight runs', value: data.runs }, { id: 'memory', title: 'Recent memory', empty: 'No recent memory', value: data.memory }, { id: 'triggers', title: 'Trigger health', empty: 'No trigger activity', value: data.triggers }, { id: 'usage', title: 'Usage', empty: 'No usage recorded', value: data.usage }, { id: 'skills', title: 'Skills queue', empty: 'No skills to review', value: data.skills }] }
function hasValue(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.keys(object).some(key => hasValue(object[key]))
  }
  return true
}

export function briefValue(data: Record<string, unknown>, key: string): string {
  const id = key === 'pending' ? 'waiting' : key
  const card = briefCards(data).find(item => item.id === id)
  if (!card || !hasValue(card.value)) return card?.empty ?? 'No data'
  return JSON.stringify(card.value)
}

export function Brief({ data = {} }: { data?: Record<string, unknown> }) { return <section className="brief">{briefCards(data).map(card => <article key={card.id}><h2>{card.title}</h2><p>{hasValue(card.value) ? JSON.stringify(card.value) : card.empty}</p></article>)}</section> }
