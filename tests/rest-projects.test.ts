import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { createRestHandler } from '../src/server/rest.js'
import { createSession, saveSession } from '../src/session/store.js'

function makeReq(method: string, url: string, body?: unknown) {
  const json = body !== undefined ? JSON.stringify(body) : ''
  const req: any = Readable.from(json ? [Buffer.from(json)] : [])
  req.url = url
  req.method = method
  req.headers = {}
  return req
}

function makeRes() {
  const res: any = {
    statusCode: 0, body: '',
    writeHead(status: number) { res.statusCode = status; return res },
    end(chunk?: string) { if (chunk) res.body = chunk },
    setHeader() {},
  }
  return res
}

const handle = createRestHandler({ defaultProfile: { name: 'test' } } as any)

describe('REST project endpoints', () => {
  it('create, list (incl inbox), project sessions, assign', async () => {
    const user = 'restuser'

    const cres = makeRes()
    await handle(makeReq('POST', '/projects', { user, name: 'RP' }), cres)
    expect(cres.statusCode).toBe(201)
    const created = JSON.parse(cres.body).project
    expect(created.name).toBe('RP')

    const lres = makeRes()
    await handle(makeReq('GET', `/projects?user=${user}`), lres)
    expect(lres.statusCode).toBe(200)
    const projects = JSON.parse(lres.body).projects
    expect(projects.some((p: any) => p.id === 'inbox')).toBe(true)
    expect(projects.some((p: any) => p.id === created.id)).toBe(true)

    const sres = makeRes()
    await handle(makeReq('GET', `/projects/${created.id}/sessions?user=${user}`), sres)
    expect(sres.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(sres.body).sessions)).toBe(true)

    const s = createSession('test', user); saveSession(s)
    const ares = makeRes()
    await handle(makeReq('PATCH', `/sessions/${s.id}`, { user, projectId: created.id }), ares)
    expect(ares.statusCode).toBe(200)
    const after = JSON.parse(ares.body).sessions
    expect(after.find((r: any) => r.id === s.id)?.project).toBe(created.id)
  })

  it('returns 400 when user is missing', async () => {
    const res = makeRes()
    await handle(makeReq('GET', '/projects'), res)
    expect(res.statusCode).toBe(400)
  })
})
