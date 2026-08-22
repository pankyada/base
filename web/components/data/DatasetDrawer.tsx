'use client'
import { useEffect, useState } from 'react'
import type { DatasetColumn, DatasetRecord, DatasetSchema } from '../../lib/datasets'
import { SchemaCard } from './SchemaCard'
import { DataTable } from '../../widgets/DataTable'

export function nullPercent(column: DatasetColumn, rows: number | undefined): number { return !rows ? 0 : Math.round((column.nulls / rows) * 100) }
export function datasetContext(dataset: DatasetRecord, columns: string[]): string { return `[dataset ${dataset.filename} at ${dataset.path}; ${dataset.rows ?? 'unknown'} rows × ${dataset.columns ?? 'unknown'} columns; columns: ${columns.join(', ') || 'none'}; provenance: ${dataset.provenance}]` }
export function uploadPercent(loaded: number, total: number): number { return total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0 }
export function uploadDataset(baseUrl: string, file: File, onProgress: (percent: number) => void): Promise<DatasetRecord> { return new Promise((resolve, reject) => { const request = new XMLHttpRequest(); request.open('POST', `${baseUrl}/datasets`); request.upload.onprogress = event => onProgress(uploadPercent(event.loaded, event.total)); request.onerror = () => reject(new Error('upload failed')); request.onload = () => { if (request.status >= 200 && request.status < 300) resolve(JSON.parse(request.responseText).dataset); else reject(new Error(`upload failed (${request.status})`)) }; const form = new FormData(); form.append('file', file); request.send(form) }) }

interface Props { baseUrl: string; onContext: (context: string) => void }
export function DatasetDrawer({ baseUrl, onContext }: Props) {
  const [datasets, setDatasets] = useState<DatasetRecord[]>([])
  const [selected, setSelected] = useState<DatasetRecord>()
  const [schema, setSchema] = useState<DatasetSchema>()
  const [preview, setPreview] = useState<{ columns: string[]; rows: Record<string, unknown>[] }>()
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState<number>()
  const load = async () => { try { const response = await fetch(`${baseUrl}/datasets`); if (!response.ok) throw new Error(`datasets request failed (${response.status})`); setDatasets((await response.json()).datasets ?? []) } catch (cause) { setError(cause instanceof Error ? cause.message : 'datasets request failed') } }
  useEffect(() => { void load() }, [baseUrl])
  const select = async (dataset: DatasetRecord) => { setSelected(dataset); try { const [schemaResponse, previewResponse] = await Promise.all([fetch(`${baseUrl}/datasets/${dataset.id}/schema`), fetch(`${baseUrl}/datasets/${dataset.id}/preview`)]); setSchema((await schemaResponse.json()).schema); const previewBody = await previewResponse.json(); setPreview(previewBody); onContext(datasetContext(dataset, previewBody.columns ?? [])) } catch (cause) { setError(cause instanceof Error ? cause.message : 'dataset detail request failed') } }
  const upload = async (file: File) => { setProgress(0); try { await uploadDataset(baseUrl, file, setProgress); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'upload failed') } finally { setProgress(undefined) } }
  return <aside className="dataset-drawer"><h2>Datasets</h2><input type="file" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />{progress != null ? <progress value={progress} max={100}>{progress}%</progress> : null}{error ? <div role="alert">{error}</div> : null}<ul>{datasets.map(dataset => <li key={dataset.id}><button onClick={() => void select(dataset)}>{dataset.name}</button>{dataset.provenance === 'untrusted' ? <small> untrusted</small> : null}</li>)}</ul>{selected && schema ? <SchemaCard schema={schema} rows={selected.rows} /> : null}{preview ? <DataTable data={preview.rows} /> : null}</aside>
}
