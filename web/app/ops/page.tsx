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
import { ApprovalQueue } from '../../components/ops/ApprovalQueue'
import { MissionCard } from '../../components/ops/MissionCard'
import type { ClientMessage, MissionWire, PendingInput } from '../../lib/protocol'
import { buildScopedUrl } from '../../lib/scopedRequest'
import { fetchBatch, fetchRemote, type RemoteData } from '../../lib/remoteData'
import { sendFailureReason } from '../../hooks/useHarnessWS'
import { Unavailable } from '../../components/chrome/Unavailable'

interface ChannelStatus { name: string; transport: string; binding: 'paired' | 'open' | 'unbound' | 'off'; degraded?: string }
type Reads = { pending: { pending?: PendingInput[] }; channels: { channels?: ChannelStatus[] }; metrics: unknown; usage: unknown; routing: unknown }
type ReadStates = { [K in keyof Reads]: RemoteData<Reads[K]> }
const initialReads = (): ReadStates => ({ pending: { status: 'loading' }, channels: { status: 'loading' }, metrics: { status: 'loading' }, usage: { status: 'loading' }, routing: { status: 'loading' } })

export default function OpsPage() {
  const { userId, operator } = useSharedHarnessWS()
  return <OpsContent key={JSON.stringify([userId, operator.profile])} />
}

function OpsContent() {
  const base = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'
  const { events, send, userId, operator, dispatchOperator, status, subscribe } = useSharedHarnessWS()
  const profile = operator.profile
  const scope = { userId, profile }
  const [reads, setReads] = useState<ReadStates>(initialReads)
  const [pending, setPending] = useState<PendingInput[]>([])
  const [channels, setChannels] = useState<ChannelStatus[]>([])
  const [report, setReport] = useState<Record<string, unknown>>({})
  const [lastUpdated, setLastUpdated] = useState<string>()
  const [refreshTick, setRefreshTick] = useState(0)
  const [actionError, setActionError] = useState<string>()
  const refreshNow = useRef<() => void>(() => {})
  const scopeKey = `${userId}\u0000${profile ?? ''}`
  const currentScope = useRef(scopeKey)
  currentScope.current = scopeKey
  const missionMessage = [...events].reverse().find(event => event.type === 'mission')
  const receiptMessage = [...events].reverse().find(event => event.type === 'receipt')

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let queued = false
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    let abort: AbortController | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    setReads(initialReads()); setPending([]); setChannels([]); setReport({}); setLastUpdated(undefined); setActionError(undefined)
    const refresh = async () => {
      if (disposed) return
      if (inFlight) { queued = true; return }
      inFlight = true
      abort = new AbortController()
      deadline = setTimeout(() => abort?.abort(), 10_000)
      const options = { signal: abort.signal }
      const batch = await fetchBatch<Reads>({
        pending: () => fetchRemote(buildScopedUrl(base, '/pending', { userId }, { state: 'open' }), undefined, options),
        channels: () => fetchRemote(buildScopedUrl(base, '/channels', { userId }), undefined, options),
        metrics: () => fetchRemote(buildScopedUrl(base, '/metrics', { profile }), undefined, options),
        usage: () => fetchRemote(buildScopedUrl(base, '/usage', { userId }), undefined, options),
        routing: () => fetchRemote(buildScopedUrl(base, '/stats/routing', {}), undefined, options),
      })
      clearTimeout(deadline)
      inFlight = false
      if (disposed) return
      setReads(batch)
      if (batch.pending.status === 'ready') {
        const rows = (batch.pending.data.pending ?? []).filter(item => item.state === 'open' && (!profile || item.profile === profile) && Date.parse(item.expires_at) > Date.now())
        setPending(rows)
        dispatchOperator({ type: 'message', payload: { type: 'pending', pending: rows } })
      } else if (batch.pending.status === 'empty') setPending([])
      if (batch.channels.status === 'ready') setChannels(batch.channels.data.channels ?? [])
      else if (batch.channels.status === 'empty') setChannels([])
      setReport(current => ({ ...current, ...Object.fromEntries(['metrics', 'usage', 'routing'].flatMap(key => {
        const result = batch[key as 'metrics' | 'usage' | 'routing']
        return result.status === 'ready' ? [[key, result.data]] : result.status === 'empty' ? [[key, {}]] : []
      })) }))
      if (Object.values(batch).every(value => value.status !== 'failed')) setLastUpdated(new Date().toISOString())
      setRefreshTick(tick => tick + 1)
      if (queued) { queued = false; void refresh() }
    }
    refreshNow.current = () => { void refresh() }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    const unsubscribe = subscribe(message => {
      if (!['pending', 'pending_result', 'turn_start', 'session_end', 'stats', 'skill_result'].includes(message.type)) return
      if (eventTimer) return
      eventTimer = setTimeout(() => { eventTimer = undefined; void refresh() }, 250)
    })
    return () => { disposed = true; abort?.abort(); clearTimeout(deadline); clearTimeout(eventTimer); clearInterval(timer); unsubscribe(); refreshNow.current = () => {} }
  }, [base, userId, profile, status, subscribe, dispatchOperator])

  const sendChecked = (message: ClientMessage): boolean => {
    const result = send(message)
    if (!result.ok) setActionError(sendFailureReason(result))
    else setActionError(undefined)
    return result.ok
  }
  const resolveApproval = (id: string, approve: boolean, remember = false) => {
    const requestId = crypto.randomUUID()
    dispatchOperator({ type: 'decision', id, requestId })
    const result = send({ type: approve ? 'tool_approve' : 'tool_deny', id, ...(remember ? { remember: true } : {}), request_id: requestId })
    if (!result.ok) dispatchOperator({ type: 'decision_failed', id, requestId, error: sendFailureReason(result) })
  }
  const answer = (id: string, value: string) => {
    const requestId = crypto.randomUUID()
    dispatchOperator({ type: 'answer', id, requestId })
    const result = send({ type: 'pending_answer', pending_id: id, value, request_id: requestId })
    if (!result.ok) dispatchOperator({ type: 'answer_failed', id, requestId, error: sendFailureReason(result) })
  }
  const cancel = async (id: string) => {
    const atScope = scopeKey
    try {
      const response = await fetch(buildScopedUrl(base, `/runs/${encodeURIComponent(id)}`, { userId }), { method: 'DELETE' })
      if (!response.ok) throw new Error(`Cancel failed (${response.status}): ${await response.text()}`)
      if (currentScope.current === atScope) { setActionError(undefined); refreshNow.current() }
    } catch (error) { if (currentScope.current === atScope) setActionError(error instanceof Error ? error.message : 'Cancel failed') }
  }
  const failures = Object.entries(reads).filter(([, result]) => result.status === 'failed').map(([name, result]) => `${name}: ${result.status === 'failed' ? result.reason : ''}`)
  return <Shell><main className="route-page">
    {actionError ? <p role="alert">{actionError}</p> : null}
    {operator.recoveryError ? <p role="alert">{operator.recoveryError}</p> : null}
    <p role="status">{lastUpdated ? `Last full snapshot update: ${new Date(lastUpdated).toLocaleTimeString()}` : 'Waiting for a complete snapshot update.'}{failures.length ? ' Some panels unavailable; retained data may be stale.' : ''}</p>
    {failures.length ? <Unavailable reason={failures.join(' · ')} onRetry={() => refreshNow.current()} /> : null}
    <RunBoard baseUrl={base} scope={scope} refreshToken={refreshTick} onCancel={id => { void cancel(id) }} />
    <MissionCard mission={missionMessage?.type === 'mission' ? missionMessage.mission as MissionWire : undefined} receipt={receiptMessage?.type === 'receipt' ? receiptMessage.receipt : undefined} />
    <ApprovalQueue items={Object.values(operator.approvals)} onApprove={id => resolveApproval(id, true)} onDeny={id => resolveApproval(id, false)} onRemember={id => resolveApproval(id, true, true)} />
    {reads.pending.status === 'loading' ? <p role="status">Loading pending asks…</p> : reads.pending.status === 'failed' ? null : <Inbox items={pending} answers={Object.fromEntries(Object.entries(operator.answers).map(([id, value]) => [id, { busy: Boolean(value.requestId), error: value.error }]))} onAnswer={answer} />}
    <UndoDrawer entries={operator.undoEntries} onUndo={(id, force, reason) => sendChecked({ type: 'undo_apply', id, force, ...(reason ? { reason } : {}) })} />
    <Observability report={report} budget={operator.budget} />
    <AuditTable baseUrl={base} scope={scope} />
    <SkillsQueue proposed={operator.skills?.proposed} installed={operator.skills?.installed} content={operator.content} onAction={(action, name) => sendChecked({ type: action === 'promote' ? 'skill_promote' : 'skill_discard', name })} onSave={(name, content) => sendChecked({ type: 'skill_save', name, content })} />
    {reads.channels.status === 'loading' ? <p role="status">Loading channels…</p> : reads.channels.status === 'failed' ? null : <Channels channels={channels} />}
  </main></Shell>
}
