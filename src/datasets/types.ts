export interface DatasetRecord {
  id: string
  name: string
  filename: string
  path: string
  bytes: number
  rows?: number
  columns?: number
  created_at: string
  provenance: 'untrusted'
}

export interface DatasetColumn {
  name: string
  dtype: 'number' | 'boolean' | 'string' | 'null' | 'unknown'
  nulls: number
  distinct: number
  sample: unknown[]
}

export interface DatasetSchema { columns: DatasetColumn[] }
export interface DatasetPreview { columns: string[]; rows: Array<Record<string, unknown>> }
