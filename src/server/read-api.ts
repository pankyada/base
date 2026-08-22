import type { IncomingMessage, ServerResponse } from 'http'
import { createHash } from 'crypto'
import { aggregateRouting } from '../analysis/routing.js'
import { listAudit } from '../audit/query.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import type { MemoryProvider, MemoryScope } from '../memory/interface.js'
import { createSession, loadSession } from '../session/store.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { queryEvents } from '../telemetry/query.js'
import { aggregateMetrics } from '../telemetry/aggregate.js'
import { readUsage } from '../usage/ledger.js'
import type { Profile } from '../profiles/schema.js'
import { DatasetError, DatasetStore } from '../datasets/store.js'

type Cursor = { file: string; offset: number }

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCursor(cursor: string): Cursor | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return typeof value?.file === 'string' && Number.isInteger(value.offset) && value.offset >= 0 ? value : null
  } catch {
    return null
  }
}

export interface ReadApiDeps {
  defaultProfile: Profile
  profiles?: Map<string, Profile>
  queryEvents?: typeof queryEvents
  readUsage?: typeof readUsage
  listAudit?: typeof listAudit
  loadSession?: typeof loadSession
  memoryFor?: (profile: Profile, user: string, sessionId?: string) => MemoryProvider
  datasetStore?: DatasetStore
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function date(value: string | null, name: string): Date | undefined {
  if (!value) return undefined
  const relative = /^(\d+)d$/.exec(value)
  if (relative) return new Date(Date.now() - Number(relative[1]) * 86_400_000)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, `invalid ${name}`)
  return parsed
}

function limit(value: string | null): number {
  if (!value) return 100
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, 'invalid limit')
  return Math.min(parsed, 1000)
}

function bool(value: string | null, name: string): boolean | undefined {
  if (value === null) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  throw new HttpError(400, `invalid ${name}`)
}

function oneOf(value: string | null, allowed: string[], name: string): string | undefined {
  if (value === null) return undefined
  if (!allowed.includes(value)) throw new HttpError(400, `invalid ${name}`)
  return value
}

function send(res: ServerResponse, status: number, body: unknown, cacheControl = 'max-age=5'): void {
  const json = JSON.stringify(body)
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': cacheControl }
  if (cacheControl !== 'no-store') headers.etag = `"${createHash('sha256').update(json).digest('hex').slice(0, 16)}"`
  res.writeHead(status, headers)
  res.end(json)
}

function defaultMemory(profile: Profile, user: string, sessionId?: string): MemoryProvider {
  const session = sessionId ? loadSession(user, sessionId) : null
  return new FsMemoryProvider(profile.artifact_dir, session ?? createSession(profile.name, user))
}

function projection(messages: unknown[], max: number): unknown[] {
  return messages.slice(Math.max(0, messages.length - max)).map(message => {
    if (!message || typeof message !== 'object') return message
    const item = message as { role?: unknown; content?: unknown }
    if (item.role === 'tool' && typeof item.content === 'string' && item.content.length > 2000) return { ...item, content: `${item.content.slice(0, 2000)}…`, restore_handle: 'truncated' }
    return item
  })
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new DatasetError(413, 'dataset exceeds maximum size')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

function multipart(contentType: string | undefined, body: Buffer): { filename: string; name?: string; content: Buffer } {
  const boundary = /boundary=([^;]+)/i.exec(contentType ?? '')?.[1]?.replace(/^"|"$/g, '')
  if (!boundary) throw new DatasetError(400, 'multipart file is required')
  const marker = Buffer.from(`--${boundary}`)
  const parts: Buffer[] = []
  let offset = 0
  while (offset < body.length) {
    const start = body.indexOf(marker, offset)
    if (start < 0) break
    const next = body.indexOf(marker, start + marker.length)
    if (next < 0) break
    parts.push(body.subarray(start + marker.length + 2, next - 2))
    offset = next
  }
  let filename: string | undefined
  let content: Buffer | undefined
  let name: string | undefined
  for (const part of parts) {
    const divider = part.indexOf(Buffer.from('\r\n\r\n'))
    if (divider < 0) continue
    const headers = part.subarray(0, divider).toString('utf8')
    const value = part.subarray(divider + 4)
    const field = /name="([^"]+)"/.exec(headers)?.[1]
    const foundFilename = /filename="([^"]*)"/.exec(headers)?.[1]
    if (field === 'file' && foundFilename) { filename = foundFilename; content = value }
    if (field === 'name') name = value.toString('utf8')
  }
  if (!filename || !content) throw new DatasetError(400, 'multipart file is required')
  return { filename, name, content }
}

export function createReadApiHandler(deps: ReadApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const events = deps.queryEvents ?? queryEvents
  const usage = deps.readUsage ?? readUsage
  const audit = deps.listAudit ?? listAudit
  const sessionLoader = deps.loadSession ?? loadSession
  const memoryFor = deps.memoryFor ?? defaultMemory
  const datasets = deps.datasetStore ?? new DatasetStore()

  return async (req, res) => {
    const request = new URL(req.url ?? '/', 'http://localhost')
    const path = request.pathname
    const datasetRoute = path === '/datasets' || /^\/datasets\/[^/]+\/(schema|preview)$/.test(path)
    const datasetDelete = req.method === 'DELETE' && /^\/datasets\/[^/]+$/.test(path)
    const readable = ['GET'].includes(req.method ?? 'GET') && (['/metrics', '/usage', '/audit', '/memory', '/triggers', '/stats/routing'].includes(path) || /^\/sessions\/[^/]+\/messages$/.test(path) || datasetRoute)
    const upload = req.method === 'POST' && path === '/datasets'
    if (!readable && !upload && !datasetDelete) return false
    try {
      const params = request.searchParams
      const user = sanitizeUserId(params.get('user') ?? process.env.HARNESS_USER ?? 'anonymous')
      const since = date(params.get('since'), 'since')
      const until = date(params.get('until'), 'until')
      if (since && until && since > until) throw new HttpError(400, 'since must be before until')
      if (upload) {
        const file = multipart(req.headers['content-type'], await readBody(req, datasets.maxBytes ?? 100 * 1024 * 1024))
        send(res, 201, datasets.upload(user, file), 'no-store')
        return true
      }
      if (path === '/datasets') {
        send(res, 200, { datasets: datasets.list(user) })
        return true
      }
      if (datasetDelete) {
        const id = path.slice('/datasets/'.length)
        datasets.delete(user, id)
        res.writeHead(204)
        res.end()
        return true
      }
      const datasetRouteMatch = /^\/datasets\/([^/]+)\/(schema|preview)$/.exec(path)
      if (datasetRouteMatch) {
        const [, id, resource] = datasetRouteMatch
        if (resource === 'schema') send(res, 200, datasets.schema(user, id))
        else send(res, 200, datasets.preview(user, id, limit(params.get('rows'))))
        return true
      }
      if (path === '/metrics') {
        const kind = params.get('kind') ?? undefined
        const allowedKinds = ['tool', 'skill', 'mcp', 'llm', 'safety', 'stage', 'outcome', 'trigger']
        if (kind && !allowedKinds.includes(kind)) throw new HttpError(400, 'invalid kind')
        const profile = params.get('profile') ?? undefined
        const report = aggregateMetrics(events({ profile, since, kind: kind as any }), { profile, since, until, kind: kind as any })
        send(res, 200, report)
        return true
      }
      if (path === '/usage') {
        const record = usage(user) ?? { user, total: { input: 0, output: 0, cost_usd: 0 }, by_month: {}, updated_at: null }
        send(res, 200, { ...record, months: Object.entries(record.by_month).sort(([left], [right]) => left.localeCompare(right)).map(([month, value]) => ({ month, ...value })) })
        return true
      }
      if (path === '/audit') {
        const effect = oneOf(params.get('effect'), ['read', 'write', 'outbound', 'destructive'], 'effect')
        const decision = oneOf(params.get('decision'), ['allow', 'prompt', 'deny'], 'decision')
        const tainted = bool(params.get('tainted'), 'tainted')
        const rows = audit(user, params.get('tool') ?? undefined, since)
          .filter(entry => !effect || entry.effect === effect)
          .filter(entry => !decision || entry.decision === decision)
          .filter(entry => tainted === undefined || entry.tainted === tainted)
        const offset = params.get('cursor') ? decodeCursor(params.get('cursor')!)?.offset : 0
        if (offset === undefined || offset === null) throw new HttpError(400, 'invalid cursor')
        const size = limit(params.get('limit'))
        const page = rows.slice(offset, offset + size).map(({ undo, ...entry }) => ({ ...entry, undo: Boolean(undo) }))
        send(res, 200, { entries: page, ...(offset + page.length < rows.length ? { cursor: encodeCursor({ file: 'audit', offset: offset + page.length }) } : {}) }, 'no-store')
        return true
      }
      if (path === '/memory') {
        const scope = params.get('scope') ?? 'user'
        if (!['session', 'user', 'profile', 'project'].includes(scope)) throw new HttpError(400, 'invalid scope')
        const profile = deps.profiles?.get(params.get('profile') ?? '') ?? deps.defaultProfile
        const provider = memoryFor(profile, user, params.get('session') ?? undefined)
        const query = { text: params.get('q') ?? undefined, entity: params.get('entity') ?? undefined, relation: params.get('relation') ?? undefined, at: params.get('at') ?? undefined, limit: limit(params.get('limit')) }
        const includeSuperseded = bool(params.get('include_superseded'), 'include_superseded') ?? false
        let entries
        if (includeSuperseded) {
          entries = (await provider.list(scope as MemoryScope))
            .filter(entry => (!query.entity || entry.temporal?.entity === query.entity) && (!query.text || `${entry.key} ${entry.content ?? entry.preview}`.toLowerCase().includes(query.text.toLowerCase())))
            .slice(0, query.limit)
        } else {
          entries = query.text || query.entity || query.relation || query.at
            ? await provider.query(scope as MemoryScope, query)
            : await provider.list(scope as MemoryScope)
        }
        send(res, 200, { entries }, 'no-store')
        return true
      }
      if (path === '/triggers') {
        const profiles = deps.profiles ? [...deps.profiles.values()] : [deps.defaultProfile]
        const triggerEvents = events({ kind: 'trigger' })
        const triggers = profiles.flatMap(profile => [
          ...(profile.triggers?.cron ? [{ name: 'cron', kind: 'cron', schedule: profile.triggers.cron, profile: profile.name, enabled: true }] : []),
          ...(profile.triggers?.watch ?? []).map(item => ({ name: item.name, kind: 'watch', source: item.path, profile: profile.name, enabled: true })),
          ...(profile.triggers?.poll ?? []).map(item => ({ name: item.name, kind: 'poll', schedule: item.every, profile: profile.name, enabled: true })),
        ]).map(trigger => {
          const matching = triggerEvents.filter(event => event.profile === trigger.profile && event.source === trigger.kind && (event.name ?? 'cron') === trigger.name)
          const last = matching.at(-1)
          const skipped = matching.filter(event => !event.fired)
          const skip_reasons = skipped.reduce<Record<string, number>>((counts, event) => {
            const reason = event.skip_reason ?? 'unknown'
            counts[reason] = (counts[reason] ?? 0) + 1
            return counts
          }, {})
          return { ...trigger, last_fire: last?.fired ? last.ts : null, next_fire: null, fires: matching.filter(event => event.fired).length, skips: skipped.length, skip_reasons }
        })
        send(res, 200, { triggers })
        return true
      }
      if (path === '/stats/routing') {
        send(res, 200, aggregateRouting(events({ since })))
        return true
      }
      const sessionId = path.split('/')[2]
      const session = sessionLoader(user, sessionId)
      if (!session) throw new HttpError(404, 'unknown session')
      const size = limit(params.get('limit'))
      const before = params.get('before') ? decodeCursor(params.get('before')!)?.offset : session.messages.length
      if (before === undefined || before === null || before > session.messages.length) throw new HttpError(400, 'invalid before cursor')
      const start = Math.max(0, before - size)
      const messages = projection(session.messages.slice(start, before), size)
      send(res, 200, { messages, ...(start > 0 ? { before: encodeCursor({ file: sessionId, offset: start }) } : {}) }, 'no-store')
      return true
    } catch (error) {
      if (error instanceof HttpError) send(res, error.status, { error: error.message }, 'no-store')
      else if (error instanceof DatasetError) send(res, error.statusCode, { error: error.message }, 'no-store')
      else send(res, 500, { error: 'internal error' }, 'no-store')
      return true
    }
  }
}
