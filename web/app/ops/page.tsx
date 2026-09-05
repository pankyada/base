'use client'

import { useEffect, useState } from 'react'
import { Shell } from '../../components/chrome/Shell'
import { useSharedHarnessWS } from '../../components/chrome/SocketProvider'
import { RunBoard } from '../../components/ops/RunBoard'
import { Inbox } from '../../components/ops/Inbox'
import { UndoDrawer } from '../../components/ops/UndoDrawer'
import { Observability } from '../../components/ops/Observability'
import { SkillsQueue } from '../../components/ops/SkillsQueue'
import { Channels } from '../../components/ops/Channels'
import { AuditTable } from '../../components/ops/AuditTable'
import { ApprovalQueue, type ApprovalItem } from '../../components/ops/ApprovalQueue'
import { MissionCard } from '../../components/ops/MissionCard'
import type { MissionWire } from '../../lib/protocol'

interface ChannelStatus { name: string; transport: string; binding: 'paired' | 'open' | 'unbound' | 'off'; capabilities?: Record<string, unknown>; degraded?: string }

export default function OpsPage() {
  const base = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'
  const { events, send } = useSharedHarnessWS()
  const [pending, setPending] = useState<{ id: string; prompt: string; expires_at: string }[]>([])
  const [report, setReport] = useState<Record<string, unknown>>({})
  const [channels, setChannels] = useState<ChannelStatus[]>([])
  const [resolvedApprovals, setResolvedApprovals] = useState<Set<string>>(new Set())
  const missionMessage = [...events].reverse().find(event => event.type === 'mission')
  const mission = missionMessage?.type === 'mission' ? missionMessage.mission as MissionWire : undefined
  const receiptMessage = [...events].reverse().find(event => event.type === 'receipt')

  useEffect(() => {
    send({ type: 'skills_list' })
    void fetch(base + '/pending').then(response => response.ok ? response.json() : { pending: [] }).then(body => setPending(body.pending ?? [])).catch(() => setPending([]))
    void fetch(base + '/channels').then(response => response.ok ? response.json() : { channels: [] }).then(body => setChannels(body.channels ?? [])).catch(() => setChannels([]))
    void Promise.all(['/metrics', '/usage', '/stats/routing'].map(path => fetch(base + path).then(response => response.ok ? response.json() : {}))).then(([metrics, usage, routing]) => setReport({ metrics, usage, routing })).catch(() => setReport({}))
  }, [base, send])

  const undoMessage = [...events].reverse().find(event => event.type === 'undo_entries')
  const undoEntries = undoMessage?.type === 'undo_entries' ? undoMessage.entries : []
  const skillsMessage = [...events].reverse().find(event => event.type === 'skills')
  const skills = skillsMessage?.type === 'skills' ? skillsMessage : undefined
  const sessionReady = [...events].reverse().find(event => event.type === 'session_ready')
  const latestStats = [...events].reverse().find(event => event.type === 'stats')
  const liveBudget = sessionReady?.type === 'session_ready' && sessionReady.budget
    ? { cost: latestStats?.type === 'stats' ? latestStats.cost_usd : 0, limit: sessionReady.budget.max_cost_usd }
    : undefined
  const content = Object.fromEntries(events.filter(event => event.type === 'skill_content').map(event => event.type === 'skill_content' ? [event.name, event.content] : []))
  const approvals = events.filter(event => event.type === 'tool_prompt' && !resolvedApprovals.has(event.id)).map(event => event.type === 'tool_prompt' ? ({ id: event.id, name: event.name, input: event.input, risk: event.risk, reason: event.reason }) : null).filter(item => item !== null) as ApprovalItem[]
  const resolveApproval = (id: string, approve: boolean) => { setResolvedApprovals(current => new Set(current).add(id)); send({ type: approve ? 'tool_approve' : 'tool_deny', id }) }
  const rememberApproval = (id: string) => { setResolvedApprovals(current => new Set(current).add(id)); send({ type: 'tool_approve', id, remember: true }) }

  return <Shell><main className="route-page">
    <RunBoard baseUrl={base} liveEvents={events} onCancel={id => { void fetch(base + '/runs/' + encodeURIComponent(id), { method: 'DELETE' }) }} />
    <MissionCard mission={mission} receipt={receiptMessage?.type === 'receipt' ? receiptMessage.receipt : undefined} />
    <ApprovalQueue items={approvals} onApprove={id => resolveApproval(id, true)} onDeny={id => resolveApproval(id, false)} onRemember={rememberApproval} />
    <Inbox items={pending} onAnswer={(id, value) => send({ type: 'pending_answer', pending_id: id, value })} />
    <UndoDrawer entries={undoEntries} onUndo={(id, force, reason) => send({ type: 'undo_apply', id, force, ...(reason ? { reason } : {}) })} />
    <Observability report={report} budget={liveBudget} />
    <AuditTable baseUrl={base} />
    <SkillsQueue proposed={skills?.proposed} installed={skills?.installed} content={content} onAction={(action, name) => send({ type: action === 'promote' ? 'skill_promote' : 'skill_discard', name })} onSave={(name, value) => send({ type: 'skill_save', name, content: value })} />
    <Channels channels={channels} />
  </main></Shell>
}
