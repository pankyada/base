import { lookup } from 'dns/promises'
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'http'
import { request as httpsRequest } from 'https'
import { isIP } from 'net'
import { ToolDefinition, type ToolReturn } from '../types.js'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const TOTAL_TIMEOUT_MS = 30_000

interface WebResponse {
  status: number
  headers: Record<string, string | undefined>
  body: AsyncIterable<Uint8Array> | null
  destroy?: (error?: Error) => void
}

export interface WebFetchOptions {
  maxBytes?: number
  lookupHost?: (hostname: string) => Promise<string[]>
  request?: (url: URL, address: string, timeoutMs: number, signal: AbortSignal) => Promise<WebResponse>
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return null
  const numbers = parts.map(Number)
  return numbers.every(part => part >= 0 && part <= 255) ? numbers : null
}

function ipv6Words(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%', 1)[0]
  if (!normalized.includes(':')) return null

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const expand = (value: string): number[] => {
    if (!value) return []
    const parts = value.split(':')
    const words: number[] = []
    for (const part of parts) {
      if (part.includes('.')) {
        const ipv4 = ipv4Parts(part)
        if (!ipv4) return []
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3])
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return []
      words.push(parseInt(part, 16))
    }
    return words
  }

  const left = expand(halves[0])
  const right = halves.length === 2 ? expand(halves[1]) : []
  if (left.length === 0 && halves[0] !== '') return null
  if (right.length === 0 && halves.length === 2 && halves[1] !== '') return null
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null
  return [...left, ...Array.from({ length: missing }, () => 0), ...right]
}

function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = ipv4Parts(address)
    if (!parts) return true
    const [a, b] = parts
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      a >= 224
  }

  if (isIP(address) !== 6) return true
  const words = ipv6Words(address)
  if (!words || words.length !== 8) return true
  const allZero = words.every(word => word === 0)
  const mappedIpv4 = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff
  if (mappedIpv4) {
    const high = words[6]
    const low = words[7]
    return isBlockedAddress(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`)
  }
  const first = words[0]
  return allZero || (words.slice(0, 7).every(word => word === 0) && words[7] === 1) ||
    (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
}

function hostIsBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
}

async function defaultLookupHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map(record => record.address)
}

async function resolveSafeAddress(url: URL, lookupHost: (hostname: string) => Promise<string[]>): Promise<string> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`WebFetch blocked: unsupported URL scheme ${url.protocol}`)
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (hostIsBlocked(hostname)) {
    throw new Error(`WebFetch blocked: private hostname ${hostname}`)
  }

  const addresses = isIP(hostname) ? [hostname] : await lookupHost(hostname)
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error(`WebFetch blocked: ${hostname} resolves to a private or local address`)
  }
  return addresses[0]
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value.join(', ') : value
}

function requestResolvedUrl(url: URL, address: string, timeoutMs: number, signal: AbortSignal): Promise<WebResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    let response: IncomingMessage | undefined
    const request = transport({
      protocol: url.protocol,
      hostname: address,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'user-agent': 'harness-web-fetch/1.0',
        host: url.host,
      },
      timeout: timeoutMs,
      signal,
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    }, incoming => {
      response = incoming
      resolve({
        status: incoming.statusCode ?? 0,
        headers: {
          'content-type': headerValue(incoming.headers, 'content-type'),
          location: headerValue(incoming.headers, 'location'),
        },
        body: incoming,
        destroy: error => incoming.destroy(error),
      })
    })
    request.once('error', error => reject(error))
    request.once('timeout', () => request.destroy(new Error('WebFetch request timed out')))
    signal.addEventListener('abort', () => {
      request.destroy(new Error('WebFetch request timed out'))
      response?.destroy()
    }, { once: true })
    request.end()
  })
}

async function readBody(response: WebResponse, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > maxBytes) throw new Error(`WebFetch response exceeded max_bytes (${maxBytes})`)
      chunks.push(buffer)
    }
  } catch (error) {
    response.destroy?.(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
  return Buffer.concat(chunks)
}

async function discardBody(response: WebResponse, maxBytes: number): Promise<void> {
  await readBody(response, maxBytes)
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (named[lower]) return named[lower]
    if (lower.startsWith('#x')) {
      const point = Number.parseInt(lower.slice(2), 16)
      return Number.isSafeInteger(point) ? String.fromCodePoint(point) : match
    }
    if (lower.startsWith('#')) {
      const point = Number.parseInt(lower.slice(1), 10)
      return Number.isSafeInteger(point) ? String.fromCodePoint(point) : match
    }
    return match
  })
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim()
}

function maxBytesFor(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('WebFetch max_bytes must be a positive integer')
  return value
}

async function within<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('WebFetch timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function fetchWeb(urlText: string, options: WebFetchOptions = {}): Promise<Extract<ToolReturn, object>> {
  let current: URL
  try {
    current = new URL(urlText)
  } catch {
    throw new Error('WebFetch received an invalid URL')
  }
  const maxBytes = maxBytesFor(options.maxBytes)
  const lookupHost = options.lookupHost ?? defaultLookupHost
  const request = options.request ?? requestResolvedUrl
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS)
  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  let redirects = 0

  try {
    while (true) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('WebFetch timed out')
      const address = await within(resolveSafeAddress(current, lookupHost), remaining)
      const requestRemaining = deadline - Date.now()
      if (requestRemaining <= 0) throw new Error('WebFetch timed out')
      const response = await request(current, address, requestRemaining, controller.signal)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location
        await discardBody(response, maxBytes)
        if (!location) throw new Error('WebFetch redirect has no Location header')
        if (redirects >= MAX_REDIRECTS) throw new Error(`WebFetch exceeded redirect limit (${MAX_REDIRECTS})`)
        current = new URL(location, current)
        redirects++
        continue
      }

      const body = await readBody(response, maxBytes)
      if (response.status >= 400) throw new Error(`WebFetch returned HTTP ${response.status}`)
      const contentType = response.headers['content-type']?.toLowerCase() ?? ''
      const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml')
      const content = isHtml
        ? htmlToText(body.toString('utf8'))
        : `[WebFetch] Non-HTML response; content-type=${contentType || 'unknown'}; bytes=${body.byteLength}. Binary content not rendered.`
      return { content, provenance: 'untrusted', source: urlText, effect: 'read' }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('WebFetch timed out')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export const webFetchTool: ToolDefinition = {
  name: 'WebFetch',
  description: 'Fetch an HTTP or HTTPS URL as readable untrusted text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP or HTTPS URL to fetch' },
      max_bytes: { type: 'number', description: 'Maximum response bytes (default 2097152)' },
    },
    required: ['url'],
  },
  async execute(input) {
    const { url, max_bytes } = input as { url?: unknown; max_bytes?: unknown }
    if (typeof url !== 'string' || !url.trim()) throw new Error('WebFetch url must be a non-empty string')
    if (max_bytes !== undefined && typeof max_bytes !== 'number') throw new Error('WebFetch max_bytes must be a number')
    return fetchWeb(url, { maxBytes: max_bytes as number | undefined })
  },
}
