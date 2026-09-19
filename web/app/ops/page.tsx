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
import './ops.css'
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
  const [activeStation, setActiveStation] = useState<'audit' | 'telemetry' | 'undo' | 'skills' | 'channels'>('audit')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
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
  const telemetryReads = [reads.metrics, reads.usage, reads.routing]
  const telemetryHasSnapshot = Object.keys(report).length > 0
  const telemetryState = telemetryReads.some(result => result.status === 'failed')
    ? telemetryHasSnapshot ? 'stale' : 'unavailable'
    : telemetryReads.some(result => result.status === 'loading') ? 'loading'
      : telemetryHasSnapshot ? 'ready' : 'empty'
  const pendingState = reads.pending.status === 'failed' && pending.length ? 'stale' : reads.pending.status
  const channelsState = reads.channels.status === 'failed' && channels.length ? 'stale' : reads.channels.status
  const connectionLabel = status === 'open' ? 'CONNECTED' : status.toUpperCase()
  const snapshotLabel = lastUpdated
    ? `${status === 'open' ? 'Last full snapshot update:' : 'Last REST snapshot:'} ${new Date(lastUpdated).toLocaleTimeString()}${failures.length ? ' · STALE' : status !== 'open' ? ` · SOCKET ${status.toUpperCase()}` : ''}`
    : failures.length ? 'No complete snapshot · UNAVAILABLE' : 'Waiting for first snapshot'
  const decisionCountKnown = status === 'open' && reads.pending.status !== 'loading' && reads.pending.status !== 'failed' && Boolean(lastUpdated)
  const decisionCount = decisionCountKnown ? Object.keys(operator.approvals).length + pending.length : '—'
  const approvalStateKnown = status === 'open' && Boolean(lastUpdated)
  const approvalCount = Object.keys(operator.approvals).length
  const stations = [
    { id: 'audit' as const, label: 'Audit', state: 'unknown' },
    { id: 'telemetry' as const, label: 'Telemetry', state: telemetryState },
    { id: 'undo' as const, label: 'Undo', state: operator.undoEntries.length ? 'ready' : 'empty' },
    { id: 'skills' as const, label: 'Skills', state: operator.skills?.proposed?.length ? 'ready' : 'empty' },
    { id: 'channels' as const, label: 'Channels', state: channelsState },
  ]
  const selectStation = (index: number) => {
    const next = (index + stations.length) % stations.length
    setActiveStation(stations[next].id)
    requestAnimationFrame(() => tabRefs.current[next]?.focus())
  }
  return <Shell><main className="route-page ops-console" data-testid="ops-console">
    <header className="ops-masthead">
      <div className="ops-masthead__title">
        <span className="ops-eyebrow">CONTROL / 01 — OPERATIONS</span>
        <h1>Dispatch room</h1>
        <p>Live work, human decisions, and evidence for this harness.</p>
      </div>
      <div className="ops-masthead__context">
        <span className="ops-scope"><small>IDENTITY</small><strong>{userId || 'unknown'}</strong></span>
        <span className="ops-scope"><small>PROFILE</small><strong>{profile || 'all profiles'}</strong></span>
        <button type="button" className="ops-refresh" onClick={() => refreshNow.current()} aria-label="Refresh operator snapshot">Refresh snapshot</button>
      </div>
    </header>

    <div className="ops-signal-ribbon" role="status" aria-live="polite" data-state={failures.length ? lastUpdated ? 'stale' : 'unavailable' : lastUpdated ? 'ready' : 'loading'}>
      <span className="ops-signal"><i aria-hidden="true" data-connection={status} />Link <strong>{connectionLabel}</strong></span>
      <span className="ops-signal ops-signal--snapshot">{snapshotLabel}</span>
        <span className="ops-signal ops-signal--scope">SCOPE <strong>{profile || 'aggregate'}</strong></span>
    </div>

    {actionError ? <p role="alert" className="ops-alert ops-alert--action">Action not confirmed · {actionError}</p> : null}
    {operator.recoveryError ? <p role="alert" className="ops-alert">Recovery needs attention · {operator.recoveryError}</p> : null}
    {failures.length ? <div className="ops-global-failure"><Unavailable reason={failures.join(' · ')} onRetry={() => refreshNow.current()} /></div> : null}

    <div className="ops-dispatch-grid">
      <div className="ops-workspace">
        <div className="ops-mission-strip"><MissionCard mission={missionMessage?.type === 'mission' ? missionMessage.mission as MissionWire : undefined} receipt={receiptMessage?.type === 'receipt' ? receiptMessage.receipt : undefined} /></div>
        <RunBoard baseUrl={base} scope={scope} refreshToken={refreshTick} onCancel={id => { void cancel(id) }} />
      </div>
      <aside className="ops-intervention-rail" aria-label="Human interventions">
        <header className="ops-rail-heading"><div><span className="ops-station-label">03 / Intervention</span><h2>Decision queue</h2></div><span className="ops-queue-count" aria-label={decisionCountKnown ? `${decisionCount} outstanding decisions` : 'Decision count unavailable'}>{decisionCount}</span></header>
        <div className="ops-data-panel" data-state={approvalStateKnown ? 'ready' : approvalCount ? 'stale' : 'unavailable'}>
          {!approvalStateKnown && approvalCount === 0 ? <p role="status" className="ops-inline-state" data-state="unavailable">Approval state unavailable until the live connection is restored.</p> : null}
          {!approvalStateKnown && approvalCount > 0 ? <p role="status" className="ops-inline-state" data-state="stale">Showing retained approvals; live connection is unavailable.</p> : null}
          {approvalStateKnown || approvalCount > 0 ? <ApprovalQueue items={Object.values(operator.approvals)} onApprove={id => resolveApproval(id, true)} onDeny={id => resolveApproval(id, false)} onRemember={id => resolveApproval(id, true, true)} /> : null}
        </div>
        <div className="ops-data-panel" data-state={pendingState}>
          {reads.pending.status === 'loading' ? <p role="status" className="ops-inline-state" data-state="loading">Checking deferred asks…</p> : null}
          {reads.pending.status === 'failed' && !pending.length ? <Unavailable reason={`pending: ${reads.pending.reason}`} onRetry={() => refreshNow.current()} /> : null}
          {pendingState === 'stale' ? <p role="status" className="ops-inline-state" data-state="stale">Showing retained asks from the last successful read.</p> : null}
          {reads.pending.status !== 'loading' && (reads.pending.status !== 'failed' || pending.length > 0) ? <Inbox items={pending} answers={Object.fromEntries(Object.entries(operator.answers).map(([id, value]) => [id, { busy: Boolean(value.requestId), error: value.error }]))} onAnswer={answer} /> : null}
        </div>
      </aside>
    </div>

    <section className="ops-workbench" aria-labelledby="ops-workbench-title">
      <header className="ops-workbench__heading"><div><span className="ops-station-label">Evidence / configuration</span><h2 id="ops-workbench-title">Operator workbench</h2></div><span className="ops-workbench__hint">Snapshots refresh every 5 seconds</span></header>
      <div className="ops-tabs" role="tablist" aria-label="Operator workbench">
        {stations.map((station, index) => <button ref={element => { tabRefs.current[index] = element }} key={station.id} id={`ops-tab-${station.id}`} type="button" role="tab" aria-selected={activeStation === station.id} aria-controls={`ops-panel-${station.id}`} tabIndex={activeStation === station.id ? 0 : -1} data-state={station.state} onClick={() => setActiveStation(station.id)} onKeyDown={event => {
          if (event.key === 'ArrowRight') { event.preventDefault(); selectStation(index + 1) }
          if (event.key === 'ArrowLeft') { event.preventDefault(); selectStation(index - 1) }
          if (event.key === 'Home') { event.preventDefault(); selectStation(0) }
          if (event.key === 'End') { event.preventDefault(); selectStation(stations.length - 1) }
        }}><span>{station.label}</span><i aria-hidden="true" /></button>)}
      </div>
      <div className="ops-workbench__body">
        <div className="ops-tabpanel" id="ops-panel-audit" role="tabpanel" aria-labelledby="ops-tab-audit" hidden={activeStation !== 'audit'}><AuditTable baseUrl={base} scope={scope} /></div>
        <div className="ops-tabpanel" id="ops-panel-telemetry" role="tabpanel" aria-labelledby="ops-tab-telemetry" hidden={activeStation !== 'telemetry'} data-state={telemetryState}>
          {telemetryState === 'loading' ? <p role="status" className="ops-inline-state" data-state="loading">Reading telemetry snapshots…</p> : null}
          {telemetryState === 'unavailable' ? <p role="alert" className="ops-inline-state" data-state="unavailable">Telemetry unavailable. Use Refresh snapshot to retry.</p> : null}
          {telemetryState === 'stale' ? <p role="status" className="ops-inline-state" data-state="stale">Some telemetry reads failed; displayed figures are retained from the last successful snapshot.</p> : null}
          <Observability report={report} budget={operator.budget} state={telemetryState} />
        </div>
        <div className="ops-tabpanel" id="ops-panel-undo" role="tabpanel" aria-labelledby="ops-tab-undo" hidden={activeStation !== 'undo'}><UndoDrawer entries={operator.undoEntries} onUndo={(id, force, reason) => sendChecked({ type: 'undo_apply', id, force, ...(reason ? { reason } : {}) })} /></div>
        <div className="ops-tabpanel" id="ops-panel-skills" role="tabpanel" aria-labelledby="ops-tab-skills" hidden={activeStation !== 'skills'}><SkillsQueue proposed={operator.skills?.proposed} installed={operator.skills?.installed} content={operator.content} onAction={(action, name) => sendChecked({ type: action === 'promote' ? 'skill_promote' : 'skill_discard', name })} onSave={(name, content) => sendChecked({ type: 'skill_save', name, content })} /></div>
        <div className="ops-tabpanel" id="ops-panel-channels" role="tabpanel" aria-labelledby="ops-tab-channels" hidden={activeStation !== 'channels'} data-state={channelsState}>
          {reads.channels.status === 'loading' ? <p role="status" className="ops-inline-state" data-state="loading">Checking channel bindings…</p> : null}
          {reads.channels.status === 'failed' && !channels.length ? <Unavailable reason={`channels: ${reads.channels.reason}`} onRetry={() => refreshNow.current()} /> : null}
          {channelsState === 'stale' ? <p role="status" className="ops-inline-state" data-state="stale">Showing retained bindings from the last successful read.</p> : null}
          {reads.channels.status !== 'loading' && (reads.channels.status !== 'failed' || channels.length > 0) ? <Channels channels={channels} /> : null}
        </div>
      </div>
    </section>
  </main></Shell>
}
