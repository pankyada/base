import { openObservatoryFile, resolveObservatoryFile } from '../../../../lib/observatory-files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin) {
    try { if (new URL(origin).origin !== new URL(request.url).origin) return false } catch { return false }
  }
  return request.headers.get('sec-fetch-site') !== 'cross-site'
}
function safeDisposition(name: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`
}
function rangeFor(header: string | null, size: number): { start: number; end: number; partial: boolean } | null {
  if (!header) return { start: 0, end: Math.max(0, size - 1), partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) return null
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null
    end = Math.min(end, size - 1)
  }
  return { start, end, partial: true }
}
function baseHeaders(file: NonNullable<Awaited<ReturnType<typeof resolveObservatoryFile>>>) {
  return {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': safeDisposition(file.name),
    'Content-Type': file.contentType,
    'X-Content-Type-Options': 'nosniff',
  }
}

async function respond(request: Request, headOnly: boolean): Promise<Response> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  const url = new URL(request.url)
  const file = await resolveObservatoryFile(url.searchParams.get('collection') ?? '', url.searchParams.get('id') ?? '')
  if (!file) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  const range = rangeFor(request.headers.get('range'), file.bytes)
  if (!range) return new Response(null, { status: 416, headers: { ...baseHeaders(file), 'Content-Range': `bytes */${file.bytes}` } })
  const length = file.bytes === 0 ? 0 : range.end - range.start + 1
  const headers = new Headers({ ...baseHeaders(file), 'Content-Length': String(length) })
  if (range.partial) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${file.bytes}`)
  if (headOnly) return new Response(null, { status: range.partial ? 206 : 200, headers })
  if (file.bytes === 0) return new Response(null, { status: 200, headers })
  try {
    const stream = await openObservatoryFile(file, range.start, range.end)
    return new Response(stream as unknown as ReadableStream, { status: range.partial ? 206 : 200, headers })
  } catch {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
}

export async function GET(request: Request): Promise<Response> { return respond(request, false) }
export async function HEAD(request: Request): Promise<Response> { return respond(request, true) }
