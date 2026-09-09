'use client'
import { useEffect, useRef, useState } from 'react'
import { buildScopedUrl, type RequestScope } from '../../lib/scopedRequest'
import { fetchScopedRemote, type RemoteData } from '../../lib/remoteData'
import { Unavailable } from '../chrome/Unavailable'

interface Summary { run_id: string; accuracy: number | null; cost_usd: number; mean_latency_ms: number | null; completed_count: number; sample_count: number; status?: string }
interface EvaluationsBody { runs?: Summary[] }
// /evaluations is scoped by `user` only — src/evaluation/router.ts reads no `profile` param, it builds EvaluationStore(options.user) from the REST `scopedUser`.
export function EvaluationPanel({ baseUrl, scope = {} }: { baseUrl: string; scope?: RequestScope }) {
  const [runs, setRuns] = useState<Summary[]>([]); const [remote, setRemote] = useState<RemoteData<EvaluationsBody>>({ status: 'loading' }); const [deltas, setDeltas] = useState<Record<string, number | null> | null>(null); const [datasetId, setDatasetId] = useState(''); const [profile, setProfile] = useState('candidate'); const [config, setConfig] = useState('local'); const [message, setMessage] = useState(''); const [attempt, setAttempt] = useState(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  useEffect(() => {
    const requestedScope = scope
    setRemote({ status: 'loading' })
    setRuns([]); setDeltas(null) // drop the previous scope's evaluation runs before the new scoped read lands
    // /evaluations is scoped by `user` only in its URL, but staleness must still compare the full ambient scope (userId + profile) — a narrower URL scope must not make the response permanently stale once profile arrives.
    void fetchScopedRemote<EvaluationsBody>(baseUrl, '/evaluations', requestedScope, () => scopeRef.current, { urlScope: { userId: requestedScope.userId }, isEmpty: body => (body.runs ?? []).length === 0 }).then(result => {
      if (result === 'stale') return
      setRemote(result)
      setRuns(result.status === 'ready' ? (result.data.runs ?? []) : [])
    })
  }, [baseUrl, scope.userId, attempt])
  const compareRuns = () => { if (runs.length < 2) return; const [baseline, candidate] = runs; void fetch(buildScopedUrl(baseUrl, '/evaluations/compare', { userId: scope.userId }, { baseline: baseline.run_id, candidate: candidate.run_id })).then(response => response.ok ? response.json() : null).then(body => setDeltas(body?.deltas ?? null)).catch(() => setDeltas(null)) }
  const runFixture = (cancel = false) => { if (!datasetId && !cancel) { setMessage('Dataset id required'); return }; void fetch(buildScopedUrl(baseUrl, '/evaluations/run', { userId: scope.userId }), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cancel ? { dataset_id: datasetId, profile, config_fingerprint: config, cancel: true } : { dataset_id: datasetId, profile, config_fingerprint: config }) }).then(response => response.json()).then(body => { setMessage(body.run?.status ?? body.error ?? 'run complete'); if (body.summary) setRuns(current => [body.summary, ...current]) }).catch(() => setMessage('Evaluation request failed')) }
  return <section className="panel evaluation-panel"><div className="panel-heading"><div><span className="eyebrow">R6 / EVALUATION LAB</span><h2>Profile experiments</h2></div><div><button type="button" onClick={compareRuns}>Compare latest</button><button type="button" onClick={() => runFixture()}>Run fixture</button><button type="button" onClick={() => runFixture(true)}>Cancel</button></div></div><div className="evaluation-controls"><input aria-label="Dataset id" placeholder="dataset id" value={datasetId} onChange={event => setDatasetId(event.target.value)} /><input aria-label="Pinned profile" value={profile} onChange={event => setProfile(event.target.value)} /><input aria-label="Config fingerprint" value={config} onChange={event => setConfig(event.target.value)} />{message && <span className="muted">{message}</span>}</div>{remote.status === 'loading' ? <p role="status">Loading evaluation runs…</p> : null}{remote.status === 'failed' ? <Unavailable reason={remote.reason} onRetry={() => setAttempt(a => a + 1)} /> : null}{remote.status !== 'loading' && remote.status !== 'failed' ? <div className="evaluation-table"><div className="evaluation-head"><span>Run</span><span>Accuracy</span><span>Cost</span><span>Latency</span><span>Coverage</span></div>{runs.length === 0 ? <p>No evaluation runs yet.</p> : runs.slice(0, 8).map(run => <div className="evaluation-row" key={run.run_id}><span>{run.run_id}</span><span>{run.accuracy === null ? 'Unavailable' : `${Math.round(run.accuracy * 100)}%`}</span><span>${run.cost_usd.toFixed(4)}</span><span>{run.mean_latency_ms === null ? '—' : `${Math.round(run.mean_latency_ms)}ms`}</span><span>{run.completed_count}/{run.sample_count} <small>{run.status}</small></span></div>)}</div> : null}{deltas && <div className="evaluation-deltas"><strong>Candidate deltas</strong><span>Accuracy {deltas.accuracy_delta === null ? '—' : `${(deltas.accuracy_delta * 100).toFixed(1)}pp`}</span><span>Cost {deltas.cost_delta?.toFixed(4) ?? '—'}</span><span>Latency {deltas.latency_delta === null ? '—' : `${Math.round(deltas.latency_delta)}ms`}</span></div>}</section>
}
