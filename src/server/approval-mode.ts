import type { ApprovalMode } from '../types.js'

const MODES: ApprovalMode[] = ['strict', 'bash', 'danger', 'yolo']
const TRUSTED_MODES = new Set<string | undefined>(['developer', undefined])

function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && MODES.includes(value as ApprovalMode)
}

function stricter(left: ApprovalMode, right: ApprovalMode): ApprovalMode {
  return MODES.indexOf(left) <= MODES.indexOf(right) ? left : right
}

export function resolveApprovalLimit(profile: { approval_mode?: ApprovalMode; mode?: string }, env: NodeJS.ProcessEnv = process.env): ApprovalMode {
  const profileMode = profile.approval_mode ?? 'danger'
  const ceiling = TRUSTED_MODES.has(profile.mode) ? 'yolo' : 'danger'
  const configured = env.HARNESS_APPROVAL_MODE
  if (configured !== undefined && !isApprovalMode(configured)) {
    console.warn('[approval] invalid HARNESS_APPROVAL_MODE; using strict')
    return 'strict'
  }
  return stricter(stricter(profileMode, configured ?? 'yolo'), ceiling)
}

export function resolveRequestedApprovalMode(requested: unknown, limit: ApprovalMode): { ok: true; mode: ApprovalMode } | { ok: false; mode: ApprovalMode } | null {
  if (!isApprovalMode(requested)) return null
  return MODES.indexOf(requested) <= MODES.indexOf(limit)
    ? { ok: true, mode: requested }
    : { ok: false, mode: limit }
}

export function isYoloEnabled(mode: ApprovalMode): boolean {
  return mode === 'yolo'
}
