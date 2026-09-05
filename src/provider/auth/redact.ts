const SECRET_KEYS = /token|secret|authorization|cookie|password|code|api[-_]?key|refresh/i

export function redactSecret(value: string, visible = 4): string {
  if (!value) return value
  if (value.length <= visible * 2) return '[redacted]'
  return `${value.slice(0, visible)}…${value.slice(-visible)}`
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactSecret(value)
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEYS.test(key) ? '[redacted]' : redact(item)
    return out
  }
  return value
}

export function sanitizeError(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]')
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/((?:access|refresh)[_-]?token|authorization[_-]?code|code[_-]?verifier|user[_-]?code)[=:]\s*[^\s,;}]+/gi, '$1=[redacted]')
    .replace(/"(access_token|refresh_token|authorization_code|code_verifier|user_code)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/([?&](?:code|state|token|access_token|refresh_token|client_secret)=)[^&\s]*/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|client[_-]?secret|password|cookie)["']?\s*[:=]\s*["']?)[^\s,"';}]+/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[redacted]')
    .slice(0, 4096)
}
