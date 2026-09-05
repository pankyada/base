import { sanitizeError } from './auth/redact.js'
export class ProviderError extends Error {
  constructor(message: string, readonly options: { code?: string; status?: number; requestId?: string; retryable?: boolean; ambiguous?: boolean; retryAfterMs?: number } = {}) { super(sanitizeError(message)); this.name = 'ProviderError' }
  get code(): string | undefined { return this.options.code }
  get status(): number | undefined { return this.options.status }
  get retryable(): boolean { return this.options.retryable ?? false }
}
export function providerError(error: unknown, status?: number): ProviderError { return error instanceof ProviderError ? error : new ProviderError(sanitizeError(error), { status }) }

/** Failures that must stop the current run instead of being hidden by a helper fallback. */
export function isProviderControlFailure(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return new Set([
      'aborted',
      'deadline_exceeded',
      'max_model_calls',
      'unauthorized',
      'auth_required',
      'credential_changed',
      'disabled',
      'quota_exhausted',
      'quota_exceeded',
    ]).has(error.code ?? '')
  }
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'BudgetExceeded')
}
