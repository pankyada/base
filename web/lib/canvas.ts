import type { ArtifactKind } from './protocol'

export interface CanvasArtifact { id: string; kind: ArtifactKind; data: unknown; title?: string }
export interface Provenance { session: string; toolCall: string; code?: string }
export interface PinnedArtifact { artifact: CanvasArtifact; provenance: Provenance; stale?: boolean }
export const CANVAS_MAX_BYTES = 512 * 1024
const KEY_PREFIX = 'harness-canvas:'

function bytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return CANVAS_MAX_BYTES + 1 }
}

function bounded(items: PinnedArtifact[]): PinnedArtifact[] {
  return items.map(item => bytes(item.artifact.data) <= CANVAS_MAX_BYTES ? item : {
    ...item,
    artifact: { ...item.artifact, data: { __truncated: true, message: 'refresh to reload full data' } },
  })
}

export function loadCanvas(projectId: string): PinnedArtifact[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY_PREFIX + projectId)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as PinnedArtifact[] : []
  } catch { return [] }
}

export function saveCanvas(projectId: string, items: PinnedArtifact[]): PinnedArtifact[] {
  const safe = bounded(items)
  try { globalThis.localStorage?.setItem(KEY_PREFIX + projectId, JSON.stringify(safe)) } catch {}
  return safe
}

export function clampWidth(width: number): number { return Math.min(960, Math.max(160, Math.round(width))) }
export function pinArtifact(items: PinnedArtifact[], artifact: CanvasArtifact, provenance: Provenance): PinnedArtifact[] { return [...items, { artifact, provenance }] }
export function reorderArtifacts(items: PinnedArtifact[], from: number, to: number): PinnedArtifact[] { if (from === to || !items[from] || to < 0 || to >= items.length) return items; const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next }
export function refreshArtifact(item: PinnedArtifact, artifact: CanvasArtifact, ok: boolean): PinnedArtifact { return ok ? { ...item, artifact, stale: false } : { ...item, stale: true } }
