'use client'

import { useEffect, useRef, useState } from 'react'
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
import { buildScopedUrl, isStaleScope, type RequestScope } from '../../lib/scopedRequest'
import { fetchScopedRemote, fetchBatch, fetchRemote, type RemoteData } from '../../lib/remoteData'
import { Unavailable } from '../../components/chrome/Unavailable'

interface ChannelStatus { name: string; transport: string; binding: 'paired' | 'open' | 'unbound' | 'off'; capabilities?: Record<string, unknown>; degraded?: string }
interface PendingItem { id: string; prompt: string; expires_at: string }

/** Active profile, read off the WS event stream (ops/home don't run the reducer HarnessApp uses — `session_ready`/`profiles` events carry it directly). */
function activeProfile(events: { type: string }[]): string | undefined {
  // session_resumed also carries the (possibly switched) post-resume profile — see PT-033 —
  // so it counts as a profile source alongside session_ready/profiles.
  const message = [...events].reverse().find(event => event.type === 'session_ready' || event.type === 'session_resumed' || event.type === 'profiles')
  if (!message) return undefined
  return (message as { profile?: string; current?: string }).profile ?? (message as { current?: string }).current
}

export default function OpsPage() {
  const base = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'
  const { events, send, userId } = useSharedHarnessWS()
  const profile = activeProfile(events)
  const scope: RequestScope = { userId, profile }
  const [pending, setPending] = useState<PendingItem[]>([])
  const [pendingRemote, setPendingRemote] = useState<RemoteData<{ pending?: PendingItem[] }>>({ status: 'loading' })
  const [report, setReport] = useState<Record<string, unknown>>({})
  const [metricsRemote, setMetricsRemote] = useState<RemoteData<unknown>>({ status: 'loading' })
  const [usageRemote, setUsageRemote] = useState<RemoteData<unknown>>({ status: 'loading' })
  const [routingRemote, setRoutingRemote] = useState<RemoteData<unknown>>({ status: 'loading' })
  const [channels, setChannels] = useState<ChannelStatus[]>([])
  const [channelsRemote, setChannelsRemote] = useState<RemoteData<{ channels?: ChannelStatus[] }>>({ status: 'loading' })
  const [resolvedApprovals, setResolvedApprovals] = useState<Set<string>>(new Set())
  const [retryToken, setRetryToken] = useState(0)
  const missionMessage = [...events].reverse().find(event => event.type === 'mission')
  const mission = missionMessage?.type === 'mission' ? missionMessage.mission as MissionWire : undefined
  const receiptMessage = [...events].reverse().find(event => event.type === 'receipt')

  // Tracks the scope in effect right now so responses tagged with a superseded scope (identity/profile switched mid-flight) are discarded rather than applied.
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  useEffect(() => {
    send({ type: 'skills_list' })
  }, [send])

  useEffect(() => {
    const requestedScope = { userId: scopeRef.current.userId, profile: scopeRef.current.profile }
    const currentScope = () => scopeRef.current
    // Clear dependent state before issuing the new scoped reads — no residue from the previous identity/profile.
    setPending([]); setPendingRemote({ status: 'loading' })
    setChannels([]); setChannelsRemote({ status: 'loading' })
    setReport({}); setMetricsRemote({ status: 'loading' }); setUsageRemote({ status: 'loading' }); setRoutingRemote({ status: 'loading' })

    void fetchScopedRemote<{ pending?: PendingItem[] }>(base, '/pending', requestedScope, currentScope, { urlScope: { userId: requestedScope.userId }, isEmpty: body => (body.pending ?? []).length === 0 }).then(result => {
      if (result === 'stale') return
      setPendingRemote(result)
      setPending(result.status === 'ready' ? (result.data.pending ?? []) : [])
    })
    void fetchScopedRemote<{ channels?: ChannelStatus[] }>(base, '/channels', requestedScope, currentScope, { urlScope: { userId: requestedScope.userId }, isEmpty: body => (body.channels ?? []).length === 0 }).then(result => {
      if (result === 'stale') return
      setChannelsRemote(result)
      setChannels(result.status === 'ready' ? (result.data.channels ?? []) : [])
    })
    // /metrics and /stats/routing are aggregate reads (see src/server/read-api.ts): /metrics accepts a `profile` filter but no `user`; /stats/routing accepts neither. /usage is genuinely user-scoped.
    // Each part is fetched and reported independently (fetchBatch → Promise.allSettled) so one dead endpoint does not blank the other two.
    void fetchBatch({
      metrics: () => fetchRemote(buildScopedUrl(base, '/metrics', { profile: requestedScope.profile })),
      usage: () => fetchRemote(buildScopedUrl(base, '/usage', { userId: requestedScope.userId })),
      routing: () => fetchRemote(buildScopedUrl(base, '/stats/routing', {})),
    }).then(batch => {
      // All three parts share one scope, so a switch mid-flight is discarded as a unit — same rule as every other scoped read on this page.
      if (isStaleScope(requestedScope, currentScope())) return
      setMetricsRemote(batch.metrics); setUsageRemote(batch.usage); setRoutingRemote(batch.routing)
      setReport({
        metrics: batch.metrics.status === 'ready' ? batch.metrics.data : (batch.metrics.status === 'empty' ? {} : undefined),
        usage: batch.usage.status === 'ready' ? batch.usage.data : (batch.usage.status === 'empty' ? {} : undefined),
        routing: batch.routing.status === 'ready' ? batch.routing.data : (batch.routing.status === 'empty' ? {} : undefined),
      })
    })
  }, [base, scope.userId, scope.profile, retryToken])

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
    <RunBoard baseUrl={base} scope={scope} liveEvents={events} onCancel={id => { void fetch(buildScopedUrl(base, `/runs/${encodeURIComponent(id)}`, { userId }), { method: 'DELETE' }) }} />
    <MissionCard mission={mission} receipt={receiptMessage?.type === 'receipt' ? receiptMessage.receipt : undefined} />
    <ApprovalQueue items={approvals} onApprove={id => resolveApproval(id, true)} onDeny={id => resolveApproval(id, false)} onRemember={rememberApproval} />
    {pendingRemote.status === 'loading' ? <p role="status">Loading pending asks…</p> : null}
    {pendingRemote.status === 'failed' ? <Unavailable reason={pendingRemote.reason} onRetry={() => setRetryToken(t => t + 1)} /> : null}
    {pendingRemote.status === 'loading' || pendingRemote.status === 'failed' ? null : <Inbox items={pending} onAnswer={(id, value) => send({ type: 'pending_answer', pending_id: id, value })} />}
    <UndoDrawer entries={undoEntries} onUndo={(id, force, reason) => send({ type: 'undo_apply', id, force, ...(reason ? { reason } : {}) })} />
    {(metricsRemote.status === 'failed' || usageRemote.status === 'failed' || routingRemote.status === 'failed') ? <Unavailable reason={[metricsRemote.status === 'failed' ? `metrics: ${metricsRemote.reason}` : '', usageRemote.status === 'failed' ? `usage: ${usageRemote.reason}` : '', routingRemote.status === 'failed' ? `routing: ${routingRemote.reason}` : ''].filter(Boolean).join(' · ')} onRetry={() => setRetryToken(t => t + 1)} /> : null}
    {metricsRemote.status === 'loading' && usageRemote.status === 'loading' && routingRemote.status === 'loading' ? <p role="status">Loading observability…</p> : <Observability report={report} budget={liveBudget} />}
    <AuditTable baseUrl={base} scope={scope} />
    <SkillsQueue proposed={skills?.proposed} installed={skills?.installed} content={content} onAction={(action, name) => send({ type: action === 'promote' ? 'skill_promote' : 'skill_discard', name })} onSave={(name, value) => send({ type: 'skill_save', name, content: value })} />
    {channelsRemote.status === 'loading' ? <p role="status">Loading channels…</p> : null}
    {channelsRemote.status === 'failed' ? <Unavailable reason={channelsRemote.reason} onRetry={() => setRetryToken(t => t + 1)} /> : null}
    {channelsRemote.status === 'loading' || channelsRemote.status === 'failed' ? null : <Channels channels={channels} />}
  </main></Shell>
}
