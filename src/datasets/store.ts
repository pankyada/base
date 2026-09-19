import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join, extname } from 'path'
import { sanitizeUserId } from '../session/user-paths.js'
import { harnessStatePath } from '../config/state-paths.js'
import type { DatasetPreview, DatasetRecord, DatasetSchema } from './types.js'

const EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.ndjson', '.parquet'])
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

export class DatasetError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index++ }
      else if (character === '"') quoted = false
      else value += character
      continue
    }
    if (character === '"') quoted = true
    else if (character === delimiter) { row.push(value); value = '' }
    else if (character === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '' }
    else value += character
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row) }
  return rows
}

function parseRows(content: Buffer, extension: string): DatasetPreview {
  if (extension === '.parquet') return { columns: [], rows: [] }
  const text = content.toString('utf8').replace(/^\uFEFF/, '')
  if (extension === '.csv' || extension === '.tsv') {
    const rows = parseDelimited(text, extension === '.csv' ? ',' : '\t')
    const columns = rows.shift() ?? []
    return { columns, rows: rows.filter(row => row.some(value => value !== '')).map(row => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null]))) }
  }
  const values = extension === '.json' ? JSON.parse(text) : text.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const records = Array.isArray(values) ? values : [values]
  const columns = [...new Set(records.flatMap(value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []))]
  return { columns, rows: records.filter(value => value && typeof value === 'object' && !Array.isArray(value)).map(value => Object.fromEntries(columns.map(column => [column, (value as Record<string, unknown>)[column] ?? null]))) }
}

function infer(rows: DatasetPreview): DatasetSchema {
  return { columns: rows.columns.map(name => {
    const values = rows.rows.map(row => row[name]).filter(value => value !== null && value !== undefined && value !== '')
    const numeric = values.length > 0 && values.every(value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))))
    const boolean = values.length > 0 && values.every(value => value === true || value === false || value === 'true' || value === 'false')
    return { name, dtype: values.length === 0 ? 'null' : numeric ? 'number' : boolean ? 'boolean' : 'string', nulls: rows.rows.length - values.length, distinct: new Set(values.map(value => JSON.stringify(value))).size, sample: values.slice(0, 5) }
  }) }
}

export class DatasetStore {
  readonly maxBytes: number

  constructor(private readonly root = harnessStatePath('datasets'), maxBytes = Number(process.env.HARNESS_DATASET_MAX_BYTES ?? DEFAULT_MAX_BYTES)) {
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES
  }

  upload(user: string, input: { filename: string; content: Buffer; name?: string }): DatasetRecord {
    const extension = extname(input.filename).toLowerCase()
    if (!EXTENSIONS.has(extension)) throw new DatasetError(400, 'unsupported dataset extension')
    if (input.content.length > this.maxBytes) throw new DatasetError(413, 'dataset exceeds maximum size')
    const id = randomUUID().replace(/-/g, '').slice(0, 12)
    const dir = join(this.root, sanitizeUserId(user), id)
    mkdirSync(dir, { recursive: true })
    let preview: DatasetPreview
    try { preview = parseRows(input.content, extension) }
    catch { throw new DatasetError(400, 'malformed dataset content') }
    const record: DatasetRecord = { id, name: input.name?.trim() || input.filename, filename: input.filename, path: dir, bytes: input.content.length, rows: extension === '.parquet' ? undefined : preview.rows.length, columns: extension === '.parquet' ? undefined : preview.columns.length, created_at: new Date().toISOString(), provenance: 'untrusted' }
    writeFileSync(join(dir, 'data'), input.content)
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ record, extension }))
    return record
  }

  list(user: string): DatasetRecord[] {
    const dir = join(this.root, sanitizeUserId(user))
    if (!existsSync(dir)) return []
    return readdirSync(dir).flatMap(id => {
      try { return [JSON.parse(readFileSync(join(dir, id, 'meta.json'), 'utf8')).record as DatasetRecord] } catch { return [] }
    }).sort((left, right) => right.created_at.localeCompare(left.created_at))
  }

  schema(user: string, id: string): DatasetSchema {
    const source = this.load(user, id)
    return infer(parseRows(source.content, source.extension))
  }

  preview(user: string, id: string, rows = 50): DatasetPreview {
    if (!Number.isInteger(rows) || rows < 1) throw new DatasetError(400, 'invalid rows')
    const source = this.load(user, id)
    const data = parseRows(source.content, source.extension)
    return { columns: data.columns, rows: data.rows.slice(0, Math.min(rows, 1000)) }
  }

  delete(user: string, id: string): void {
    if (!/^[a-z0-9]+$/i.test(id)) throw new DatasetError(404, 'unknown dataset')
    const dir = join(this.root, sanitizeUserId(user), id)
    if (!existsSync(dir)) throw new DatasetError(404, 'unknown dataset')
    rmSync(dir, { recursive: true, force: true })
  }

  private load(user: string, id: string): { content: Buffer; extension: string } {
    if (!/^[a-z0-9]+$/i.test(id)) throw new DatasetError(404, 'unknown dataset')
    const dir = join(this.root, sanitizeUserId(user), id)
    try {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
      return { content: readFileSync(join(dir, 'data')), extension: meta.extension }
    } catch {
      throw new DatasetError(404, 'unknown dataset')
    }
  }
}
