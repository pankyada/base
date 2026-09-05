'use client'
import React from 'react'
import type { MissionWire } from '../../lib/protocol'
export function MissionCard({ mission, receipt }: { mission?: MissionWire; receipt?: unknown }) {
  if (!mission) return <section className="mission-card"><h2>Mission</h2><p>No mission attached.</p></section>
  const done = mission.criteria.filter(item => item.state === 'verified').length
  return <section className="mission-card" aria-label="Mission status"><h2>Mission</h2><strong data-testid="mission-status">{mission.status.replace('_', ' ')}</strong><p>{mission.outcome}</p><progress value={done} max={mission.criteria.length || 1} /> <span>{done}/{mission.criteria.length} criteria verified</span><ul>{mission.criteria.map(item => <li key={item.id}>{item.description}: {item.state}</li>)}</ul>{receipt ? <details><summary>Receipt</summary><pre>{JSON.stringify(receipt, null, 2)}</pre></details> : null}</section>
}
