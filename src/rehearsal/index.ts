import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { atomicWriteJson } from '../shared/atomic-json.js'
import { userPaths } from '../session/user-paths.js'
import type { MemoryProvider, MemoryScope } from '../memory/interface.js'

export type ProposalState = 'proposed' | 'applied' | 'cancelled' | 'stale' | 'denied'
export interface ActionProposal { version: 1; id: string; user: string; tool: string; input: Record<string, unknown>; effect: 'write' | 'delete' | 'memory_write' | 'memory_delete' | 'unsupported'; before_hashes: Record<string, string | null>; after_hashes: Record<string, string | null>; resources: string[]; estimated_cost: { min: number; max: number; estimate: true }; unsupported_details?: string; config_fingerprint: string; revision: number; state: ProposalState; created_at: string }
export const hashContent = (value: string | Buffer | null): string | null => value === null ? null : createHash('sha256').update(value).digest('hex')
export function unsupportedProposal(user: string, tool: string, input: Record<string, unknown>, configFingerprint: string): ActionProposal { return { version: 1, id: randomUUID(), user, tool, input, effect: 'unsupported', before_hashes: {}, after_hashes: {}, resources: [], estimated_cost: { min: 0, max: 0, estimate: true }, unsupported_details: 'tool has no preview adapter; rehearsal cannot call it', config_fingerprint: configFingerprint, revision: 1, state: 'proposed', created_at: new Date().toISOString() } }
export function fileWritePreview(user: string, path: string, content: string, configFingerprint: string, tool = 'Write'): ActionProposal { const before = existsSync(path) ? readFileSync(path) : null; return { version: 1, id: randomUUID(), user, tool, input: { path, content }, effect: 'write', before_hashes: { [path]: hashContent(before) }, after_hashes: { [path]: hashContent(content) }, resources: [path], estimated_cost: { min: 0, max: 0.01, estimate: true }, config_fingerprint: configFingerprint, revision: 1, state: 'proposed', created_at: new Date().toISOString() } }
export function fileDeletePreview(user: string, path: string, configFingerprint: string): ActionProposal { const before = existsSync(path) ? readFileSync(path) : null; return { ...fileWritePreview(user, path, '', configFingerprint, 'Delete'), effect: 'delete', input: { path }, before_hashes: { [path]: hashContent(before) }, after_hashes: { [path]: null } } }
export function memoryWritePreview(user: string, scope: string, key: string, content: string, before: string | null, configFingerprint: string): ActionProposal { const resource = `memory:${scope}/${key}`; return { version: 1, id: randomUUID(), user, tool: 'MemoryWrite', input: { scope, key, content }, effect: 'memory_write', before_hashes: { [resource]: hashContent(before) }, after_hashes: { [resource]: hashContent(content) }, resources: [resource], estimated_cost: { min: 0, max: 0, estimate: true }, config_fingerprint: configFingerprint, revision: 1, state: 'proposed', created_at: new Date().toISOString() } }
export function applyFileProposal(proposal: ActionProposal, input: { user: string; approve: boolean; expectedRevision: number; undo?: (path: string, before: Buffer | null) => void }): { proposal: ActionProposal; receipt: { id: string; path: string; before_hash: string | null; after_hash: string | null } } {
  if (proposal.user !== input.user) throw new Error('proposal belongs to another user')
  if (proposal.revision !== input.expectedRevision) throw new Error('stale proposal revision')
  if (!input.approve) return { proposal: { ...proposal, state: 'denied', revision: proposal.revision + 1 }, receipt: { id: randomUUID(), path: String(proposal.input.path), before_hash: proposal.before_hashes[String(proposal.input.path)] ?? null, after_hash: null } }
  if (proposal.effect !== 'write' && proposal.effect !== 'delete') throw new Error(`proposal effect '${proposal.effect}' cannot use file apply`)
  const path = String(proposal.input.path); const before = existsSync(path) ? readFileSync(path) : null
  if (hashContent(before) !== (proposal.before_hashes[path] ?? null)) throw new Error('proposal precondition changed')
  if (proposal.effect === 'delete') { if (existsSync(path)) unlinkSync(path) } else writeFileSync(path, String(proposal.input.content ?? ''), 'utf8')
  const after = existsSync(path) ? readFileSync(path) : null; input.undo?.(path, before); return { proposal: { ...proposal, state: 'applied', revision: proposal.revision + 1 }, receipt: { id: randomUUID(), path, before_hash: hashContent(before), after_hash: hashContent(after) } }
}
export async function applyMemoryProposal(proposal: ActionProposal, input: { user: string; approve: boolean; expectedRevision: number; memory: MemoryProvider }): Promise<{ proposal: ActionProposal; receipt: { id: string; resource: string; before_hash: string | null; after_hash: string | null } }> {
  if (proposal.user !== input.user) throw new Error('proposal belongs to another user')
  if (proposal.revision !== input.expectedRevision) throw new Error('stale proposal revision')
  if (!input.approve) return { proposal: { ...proposal, state: 'denied', revision: proposal.revision + 1 }, receipt: { id: randomUUID(), resource: proposal.resources[0] ?? '', before_hash: Object.values(proposal.before_hashes)[0] ?? null, after_hash: null } }
  if (proposal.effect !== 'memory_write' && proposal.effect !== 'memory_delete') throw new Error(`proposal effect '${proposal.effect}' cannot use memory apply`)
  const scope = String(proposal.input.scope) as MemoryScope; const key = String(proposal.input.key); const resource = `memory:${scope}/${key}`; const before = await input.memory.read(scope, key); const beforeHash = hashContent(before?.content ?? null)
  if (beforeHash !== (proposal.before_hashes[resource] ?? null)) throw new Error('proposal precondition changed')
  if (proposal.effect === 'memory_delete') await input.memory.delete(scope, key); else await input.memory.write(scope, key, String(proposal.input.content ?? ''))
  const after = await input.memory.read(scope, key); const afterHash = hashContent(after?.content ?? null)
  return { proposal: { ...proposal, state: 'applied', revision: proposal.revision + 1 }, receipt: { id: randomUUID(), resource, before_hash: beforeHash, after_hash: afterHash } }
}
export class ProposalStore { constructor(private readonly user: string) {} save(proposal: ActionProposal): void { if (proposal.user !== this.user) throw new Error('proposal belongs to another user'); atomicWriteJson(`${userPaths(this.user, '').artifactsDir}/proposals/${proposal.id}.json`, proposal) } }
