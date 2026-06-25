export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
  onRetry?: (attempt: number, delay: number) => void
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const status = err?.status ?? err?.response?.status
      const isRetryable =
        status === 429 ||
        (status >= 500 && status < 600) ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT'
      if (!isRetryable || attempt === maxAttempts) throw err
      // Respect Retry-After header if present
      const retryAfter = parseInt(err?.response?.headers?.['retry-after'] ?? '0', 10)
      const delay = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * Math.pow(2, attempt - 1)
      onRetry?.(attempt, delay)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}
