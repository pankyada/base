import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchWeb, htmlToText } from '../src/tools/builtin/web-fetch.js'

describe('WebFetch', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html><script>ignore()</script><body>Hello &amp; <strong>world</strong></body></html>')
        return
      }
      if (req.url === '/redirect-1') {
        res.writeHead(302, { location: '/redirect-2' })
        res.end()
        return
      }
      if (req.url === '/redirect-2') {
        res.writeHead(307, { location: '/html' })
        res.end()
        return
      }
      if (req.url === '/redirect-private') {
        res.writeHead(302, { location: 'http://private.test/html' })
        res.end()
        return
      }
      if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' })
        res.end()
        return
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('x'.repeat(2048))
        return
      }
      if (req.url === '/binary') {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end(Buffer.from([0, 1, 2, 3, 255]))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  function fixtureUrl(path: string): string {
    return `http://fixture.test:${port}${path}`
  }

  async function fixtureRequest(url: URL, _address: string, _timeoutMs: number, signal: AbortSignal) {
    const response = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
      redirect: 'manual',
      signal,
    })
    return {
      status: response.status,
      headers: {
        location: response.headers.get('location') ?? undefined,
        'content-type': response.headers.get('content-type') ?? undefined,
      },
      body: response.body as unknown as AsyncIterable<Uint8Array> | null,
    }
  }

  const fixtureLookup = async (hostname: string): Promise<string[]> =>
    hostname === 'private.test' ? ['127.0.0.1'] : ['8.8.8.8']

  it('converts HTML to readable text and decodes entities', async () => {
    const result = await fetchWeb(fixtureUrl('/html'), { lookupHost: fixtureLookup, request: fixtureRequest })

    expect(result).toMatchObject({ provenance: 'untrusted', source: fixtureUrl('/html'), effect: 'read' })
    expect(result.content).toBe('Hello & world')
  })

  it('follows redirects and revalidates the target on every hop', async () => {
    const result = await fetchWeb(fixtureUrl('/redirect-1'), { lookupHost: fixtureLookup, request: fixtureRequest })
    expect(result.content).toBe('Hello & world')

    await expect(fetchWeb(fixtureUrl('/redirect-private'), {
      lookupHost: fixtureLookup,
      request: vi.fn(fixtureRequest),
    })).rejects.toThrow(/private or local address/)
  })

  it('enforces response bytes while streaming and caps redirect loops', async () => {
    await expect(fetchWeb(fixtureUrl('/big'), {
      maxBytes: 64,
      lookupHost: fixtureLookup,
      request: fixtureRequest,
    })).rejects.toThrow(/exceeded max_bytes/)

    await expect(fetchWeb(fixtureUrl('/loop'), { lookupHost: fixtureLookup, request: fixtureRequest }))
      .rejects.toThrow(/redirect limit/)
  })

  it('returns a typed stub for non-HTML content', async () => {
    const result = await fetchWeb(fixtureUrl('/binary'), { lookupHost: fixtureLookup, request: fixtureRequest })
    expect(result.content).toContain('Non-HTML response')
    expect(result.content).toContain('application/pdf')
  })

  it('blocks literal and DNS-resolved local address classes', async () => {
    const blocked = [
      ['localhost', `http://localhost:${port}/html`],
      ['local suffix', `http://service.local:${port}/html`],
      ['RFC1918 10/8', `http://10.0.0.1:${port}/html`],
      ['RFC1918 172.16/12', `http://172.16.0.1:${port}/html`],
      ['RFC1918 192.168/16', `http://192.168.0.1:${port}/html`],
      ['loopback', `http://127.0.0.1:${port}/html`],
      ['link-local', `http://169.254.169.254:${port}/html`],
      ['IPv6 ULA', `http://[fd00::1]:${port}/html`],
    ] as const

    for (const [name, url] of blocked) {
      await expect(fetchWeb(url, { lookupHost: fixtureLookup, request: fixtureRequest }))
        .rejects.toThrow(/WebFetch blocked/)
      expect(name).toBeTruthy()
    }

    await expect(fetchWeb(fixtureUrl('/html').replace('fixture.test', 'dns-private.test'), {
      lookupHost: async () => ['192.168.1.10'],
      request: fixtureRequest,
    })).rejects.toThrow(/private or local address/)
  })

  it('keeps HTML stripping zero-dependency and whitespace-safe', () => {
    expect(htmlToText('<style>x{}</style><p>A&nbsp;&nbsp;B &lt; C</p>')).toBe('A B < C')
  })
})
