import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, Server } from 'http'
import type { AddressInfo } from 'net'
import { WebSocketServer, WebSocket } from 'ws'

function startWssWithKey(apiKey: string | undefined): Promise<{ server: Server; wss: WebSocketServer; url: string }> {
  return new Promise(resolve => {
    const server = createServer()
    const wss = new WebSocketServer({
      server,
      verifyClient: (info, cb) => {
        if (!apiKey) {
          cb(true)
          return
        }
        const auth = info.req.headers['authorization']
        if (auth === `Bearer ${apiKey}`) {
          cb(true)
        } else {
          cb(false, 401, 'Unauthorized')
        }
      },
    })
    server.listen(0, () => {
      const addr = server.address() as AddressInfo
      resolve({ server, wss, url: `ws://127.0.0.1:${addr.port}` })
    })
  })
}

describe('WS auth — HARNESS_API_KEY set', () => {
  let server: Server
  let wss: WebSocketServer
  let url: string
  const KEY = 'test-secret-key'

  beforeAll(async () => {
    ;({ server, wss, url } = await startWssWithKey(KEY))
  })
  afterAll(() => new Promise<void>(res => { wss.close(); server.close(() => res()) }))

  it('rejects connection without Authorization header', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url)
        ws.on('open', () => { ws.close(); reject(new Error('should not open')) })
        ws.on('error', (e) => resolve())
        ws.on('unexpected-response', (req, res) => {
          expect(res.statusCode).toBe(401)
          ws.terminate()
          resolve()
        })
      })
    ).resolves.toBeUndefined()
  })

  it('rejects connection with wrong token', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url, { headers: { Authorization: 'Bearer wrong-key' } })
        ws.on('open', () => { ws.close(); reject(new Error('should not open')) })
        ws.on('error', (e) => resolve())
        ws.on('unexpected-response', (req, res) => {
          expect(res.statusCode).toBe(401)
          ws.terminate()
          resolve()
        })
      })
    ).resolves.toBeUndefined()
  })

  it('accepts connection with correct Bearer token', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${KEY}` } })
        ws.on('open', () => { ws.close(); resolve() })
        ws.on('error', reject)
        ws.on('unexpected-response', (req, res) => reject(new Error(`unexpected ${res.statusCode}`)))
      })
    ).resolves.toBeUndefined()
  })
})

describe('WS auth — no HARNESS_API_KEY (dev mode)', () => {
  let server: Server
  let wss: WebSocketServer
  let url: string

  beforeAll(async () => {
    ;({ server, wss, url } = await startWssWithKey(undefined))
  })
  afterAll(() => new Promise<void>(res => { wss.close(); server.close(() => res()) }))

  it('accepts connection without Authorization header', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url)
        ws.on('open', () => { ws.close(); resolve() })
        ws.on('error', reject)
        ws.on('unexpected-response', (req, res) => reject(new Error(`unexpected ${res.statusCode}`)))
      })
    ).resolves.toBeUndefined()
  })
})
