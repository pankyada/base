import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { loadProfile } from '../profiles/loader.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { runProfileOnce } from './run-profile.js'
import { compileContract, validateAndBuildInput, processOutput } from './contract.js'
import type { Profile } from '../profiles/schema.js'
import type { AgentLoopEvents } from '../tools/types.js'

const VERSION = '0.1.0'

export interface RestDeps {
  defaultProfile: Profile
  apiKey?: string
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

function findProfilePath(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'profiles', `${name}.yaml`),
    resolve(homedir(), '.harness', 'profiles', `${name}.yaml`),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

function resolveProfile(name: string | undefined, deps: RestDeps): Profile | null {
  if (!name) return deps.defaultProfile
  const path = findProfilePath(name)
  return path ? loadProfile(path) : null
}

function headlessEvents(): AgentLoopEvents {
  return {
    onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
    onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {},
  }
}

interface RunRequest { profile?: string; user?: string; input?: unknown }

/**
 * Parse + validate the request shared by /run and /stream.
 * Returns either a ready-to-run payload, or an error with a status code.
 */
export function prepareRun(bodyText: string, deps: RestDeps):
  | { ok: true; profile: Profile; userId: string; userMessage: string; compiled: ReturnType<typeof compileContract> }
  | { ok: false; status: number; body: unknown } {
  let body: RunRequest
  try {
    body = JSON.parse(bodyText)
  } catch {
    return { ok: false, status: 400, body: { error: 'malformed JSON body' } }
  }
  if (body.input === undefined) {
    return { ok: false, status: 400, body: { error: 'missing input' } }
  }
  const profile = resolveProfile(body.profile, deps)
  if (!profile) {
    return { ok: false, status: 404, body: { error: `profile "${body.profile}" not found` } }
  }
  const compiled = compileContract(profile)
  const inputCheck = validateAndBuildInput(body.input, compiled)
  if (!inputCheck.ok) {
    const status = inputCheck.details ? 422 : 400
    return { ok: false, status, body: { error: inputCheck.error, details: inputCheck.details } }
  }
  const userId = sanitizeUserId(body.user ?? process.env.HARNESS_USER ?? 'anonymous')
  return { ok: true, profile, userId, userMessage: inputCheck.userMessage, compiled }
}

async function handleRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  let result
  try {
    result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events: headlessEvents(),
    })
  } catch (e: any) {
    return sendJson(res, 500, { error: e.message })
  }

  const out = processOutput(result.finalText, prepared.compiled)
  if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })

  return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id })
}

async function handleStream(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const abort = new AbortController()
  req.on('close', () => abort.abort())

  const events: AgentLoopEvents = {
    onToken: t => sse('token', { content: t }),
    onToolStart: (n, i) => sse('tool_start', { name: n, input: i }),
    onToolEnd: (n, r) => sse('tool_end', { name: n, result: r }),
    onToolPrompt: async () => false,
    onSessionEnd: () => {},
    onStats: (tokens_in, tokens_out, cost_usd) => sse('stats', { tokens_in, tokens_out, cost_usd }),
  }

  try {
    const result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events, signal: abort.signal,
    })
    const out = processOutput(result.finalText, prepared.compiled)
    if (!out.ok) {
      sse('error', { error: out.error })
    } else {
      sse('result', { output: out.output, usage: result.usage, session_id: result.session.id })
    }
  } catch (e: any) {
    sse('error', { error: e.message })
  } finally {
    res.end()
  }
}

export function createRestHandler(deps: RestDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0]
    const method = req.method ?? 'GET'

    if (method === 'GET' && url === '/health') {
      return sendJson(res, 200, { status: 'ok', profile: deps.defaultProfile.name, version: VERSION })
    }

    if (deps.apiKey && req.headers['authorization'] !== `Bearer ${deps.apiKey}`) {
      return sendJson(res, 401, { error: 'unauthorized' })
    }

    if (method === 'POST' && url === '/run') return handleRun(req, res, deps)
    if (method === 'POST' && url === '/stream') return handleStream(req, res, deps)

    return sendJson(res, 404, { error: 'not found' })
  }
}
