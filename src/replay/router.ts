import type { IncomingMessage, ServerResponse } from 'node:http'
import { branch, playback, type RunJournal } from './index.js'
import { ReplayStore } from './store.js'

export interface ReplayRouterOptions { user: string; store?: ReplayStore }
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
function route(url: string): { id: string; action: string } | null { const parts = url.split('?')[0].split('/').filter(Boolean); if (parts[0] !== 'replay' || !parts[1]) return null; return { id: decodeURIComponent(parts[1]), action: parts[2] ?? 'get' } }

/** Additive HTTP controls for existing server wiring. Playback emits recorded events only. */
export async function handleReplayRequest(req: IncomingMessage, res: ServerResponse, options: ReplayRouterOptions): Promise<boolean> {
  const pathname = (req.url ?? '').split('?')[0]; const store = options.store ?? new ReplayStore(options.user)
  if (req.method === 'GET' && pathname === '/replay') { json(res, 200, { journals: store.list().map(item => ({ id: item.id, mode: item.mode, events: item.events.length, effects: item.effects.length, unknown_effects: item.effects.filter(effect => effect.state === 'unknown').length, parent_run_id: item.parent_run_id })) }); return true }
  const match = route(req.url ?? ''); if (!match) return false; const journal = store.get(match.id); if (!journal) { json(res, 404, { error: 'replay journal not found' }); return true }
  try {
    if (req.method === 'GET' && match.action === 'get') { json(res, 200, { journal }); return true }
    if (req.method === 'POST' && match.action === 'playback') { const events: unknown[] = []; const result = await playback(journal, event => { events.push(event) }); json(res, 200, { ...result, events }); return true }
    if (req.method === 'POST' && match.action === 'branch') { const checkpoint = new URL(req.url ?? '', 'http://localhost').searchParams.get('checkpoint'); if (!checkpoint) { json(res, 400, { error: 'checkpoint query parameter required' }); return true }; const child = branch(journal, checkpoint); store.save(child); json(res, 201, { journal: child, parent_run_id: journal.id }); return true }
    json(res, 405, { error: 'method not allowed' }); return true
  } catch (cause) { json(res, 409, { error: cause instanceof Error ? cause.message : String(cause) }); return true }
}

export function replaySummary(journal: RunJournal): { id: string; mode: string; events: number; effects: number; unknown_effects: number; parent_run_id?: string } { return { id: journal.id, mode: journal.mode, events: journal.events.length, effects: journal.effects.length, unknown_effects: journal.effects.filter(effect => effect.state === 'unknown').length, parent_run_id: journal.parent_run_id } }
