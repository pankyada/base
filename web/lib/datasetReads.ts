import type { DatasetRecord, DatasetSchema } from './datasets'
import { buildScopedUrl } from './scopedRequest'
import { fetchRemote } from './remoteData'

export interface DatasetPreview { columns: string[]; rows: Record<string, unknown>[] }
async function read<T>(url: string, label: string): Promise<T> {
  const result = await fetchRemote<T>(url, () => false)
  if (result.status !== 'ready') throw new Error(`${label}: ${result.status === 'failed' ? result.reason : 'invalid dataset response'}`)
  return result.data
}
export async function readDatasetList(base: string, userId?: string): Promise<DatasetRecord[]> {
  const body = await read<{ datasets: DatasetRecord[] }>(buildScopedUrl(base, '/datasets', { userId }), 'datasets')
  if (!body || !Array.isArray(body.datasets)) throw new Error('invalid dataset list')
  return body.datasets
}
export async function readDatasetDetails(base: string, userId: string | undefined, id: string): Promise<{ schema: DatasetSchema; preview: DatasetPreview }> {
  const path = `/datasets/${encodeURIComponent(id)}`
  const [body, preview] = await Promise.all([
    read<DatasetSchema>(buildScopedUrl(base, `${path}/schema`, { userId }), 'schema'),
    read<DatasetPreview>(buildScopedUrl(base, `${path}/preview`, { userId }), 'preview'),
  ])
  if (!body || !Array.isArray(body.columns) || !preview || !Array.isArray(preview.columns) || !Array.isArray(preview.rows)) throw new Error('invalid dataset details')
  return { schema: body, preview }
}
