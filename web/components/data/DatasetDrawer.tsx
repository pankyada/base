'use client'
import { useEffect, useRef, useState } from 'react'
import type { DatasetColumn, DatasetRecord, DatasetSchema } from '../../lib/datasets'
import { SchemaCard } from './SchemaCard'
import { DataTable } from '../../widgets/DataTable'
import { buildScopedUrl } from '../../lib/scopedRequest'
import { readDatasetDetails, readDatasetList, type DatasetPreview } from '../../lib/datasetReads'
import { Unavailable } from '../chrome/Unavailable'

export function nullPercent(column: DatasetColumn, rows: number | undefined): number { return !rows ? 0 : Math.round((column.nulls / rows) * 100) }
export function datasetContext(dataset: DatasetRecord, columns: string[]): string { return `[dataset ${dataset.filename} at ${dataset.path}; ${dataset.rows ?? 'unknown'} rows × ${dataset.columns ?? 'unknown'} columns; columns: ${columns.join(', ') || 'none'}; provenance: ${dataset.provenance}]` }
export function uploadPercent(loaded: number, total: number): number { return total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0 }
export function uploadDataset(baseUrl: string, file: File, onProgress: (percent: number) => void): Promise<DatasetRecord> { return new Promise((resolve, reject) => { const request = new XMLHttpRequest(); request.open('POST', baseUrl); request.upload.onprogress = event => onProgress(uploadPercent(event.loaded, event.total)); request.onerror = () => reject(new Error('upload failed')); request.onload = () => { if (request.status >= 200 && request.status < 300) resolve(JSON.parse(request.responseText).dataset); else reject(new Error(`upload failed (${request.status})`)) }; const form = new FormData(); form.append('file', file); request.send(form) }) }

interface Props { baseUrl: string; userId?: string; onContext: (context: string) => void }
export function DatasetDrawer(props: Props) {
  // Remount on identity change: old data disappears in the same render and old
  // requests cannot write into the new scope's state.
  return <DatasetDrawerContent key={JSON.stringify([props.baseUrl, props.userId])} {...props} />
}

function DatasetDrawerContent({ baseUrl, userId, onContext }: Props) {
  const [datasets, setDatasets] = useState<DatasetRecord[]>([])
  const [selected, setSelected] = useState<DatasetRecord>()
  const [schema, setSchema] = useState<DatasetSchema>()
  const [preview, setPreview] = useState<DatasetPreview>()
  const [error, setError] = useState<{ reason: string; retry?: () => void }>()
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [progress, setProgress] = useState<number>()
  const active = useRef(false)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)

  const load = async () => {
    const request = ++listRequest.current
    setLoading(true); setError(undefined)
    try {
      const rows = await readDatasetList(baseUrl, userId)
      if (active.current && request === listRequest.current) setDatasets(rows)
    } catch (cause) {
      if (active.current && request === listRequest.current) setError({ reason: cause instanceof Error ? cause.message : 'datasets request failed', retry: () => { void load() } })
    } finally {
      if (active.current && request === listRequest.current) setLoading(false)
    }
  }
  useEffect(() => {
    active.current = true
    void load()
    return () => { active.current = false; listRequest.current++; detailRequest.current++ }
  }, [])

  const select = async (dataset: DatasetRecord) => {
    const request = ++detailRequest.current
    setSelected(dataset); setSchema(undefined); setPreview(undefined); setError(undefined); setDetailLoading(true)
    try {
      const result = await readDatasetDetails(baseUrl, userId, dataset.id)
      if (!active.current || request !== detailRequest.current) return
      setSchema(result.schema); setPreview(result.preview)
      onContext(datasetContext(dataset, result.preview.columns))
    } catch (cause) {
      if (active.current && request === detailRequest.current) setError({ reason: cause instanceof Error ? cause.message : 'dataset detail request failed', retry: () => { void select(dataset) } })
    } finally {
      if (active.current && request === detailRequest.current) setDetailLoading(false)
    }
  }
  const upload = async (file: File) => {
    setProgress(0); setError(undefined)
    try {
      await uploadDataset(buildScopedUrl(baseUrl, '/datasets', { userId }), file, value => { if (active.current) setProgress(value) })
      if (active.current) await load()
    } catch (cause) {
      if (active.current) setError({ reason: cause instanceof Error ? cause.message : 'upload failed' })
    } finally {
      if (active.current) setProgress(undefined)
    }
  }
  return <aside className="dataset-drawer"><h2>Datasets</h2>
    <input type="file" disabled={progress != null} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
    {progress != null ? <progress value={progress} max={100}>{progress}%</progress> : null}
    {error ? <Unavailable reason={error.reason} onRetry={error.retry} /> : null}
    {loading ? <p role="status">Loading datasets…</p> : null}
    {!loading && !error && datasets.length === 0 ? <p>No datasets.</p> : null}
    <ul>{datasets.map(dataset => <li key={dataset.id}><button onClick={() => void select(dataset)}>{dataset.name}</button>{dataset.provenance === 'untrusted' ? <small> untrusted</small> : null}</li>)}</ul>
    {detailLoading ? <p role="status">Loading dataset details…</p> : null}
    {selected && schema ? <SchemaCard schema={schema} rows={selected.rows} /> : null}
    {preview ? <DataTable data={preview.rows} /> : null}
  </aside>
}
