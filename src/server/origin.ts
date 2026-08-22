export interface OriginPolicy {
  allowed: string[]
  allowBrowserless: boolean
}

const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000'

export function loadOriginPolicy(env: NodeJS.ProcessEnv = process.env): OriginPolicy {
  const value = env.HARNESS_ALLOWED_ORIGINS?.trim() || DEFAULT_ALLOWED_ORIGINS
  const allowed = value.split(',').map(origin => origin.trim()).filter(Boolean)
  if (allowed.includes('*')) console.warn('[origin] HARNESS_ALLOWED_ORIGINS=* allows every browser origin')
  return { allowed, allowBrowserless: env.HARNESS_ALLOW_BROWSERLESS !== 'false' }
}

export function checkOrigin(origin: string | undefined, policy: OriginPolicy): { ok: true } | { ok: false; reason: string } {
  if (!origin) {
    return policy.allowBrowserless
      ? { ok: true }
      : { ok: false, reason: 'missing Origin header is not allowed' }
  }
  if (policy.allowed.includes('*') || policy.allowed.includes(origin)) return { ok: true }
  return { ok: false, reason: `origin ${origin} is not allowed` }
}
