import type { Profile } from '../profiles/schema.js'
import type { OAuthFetch } from './auth/oauth.js'
import { createProviderClient as createApiClient } from './client.js'
import { createApiKeyProvider } from './api-key.js'
import { createCodexProvider } from './codex/adapter.js'
import type { ProviderClient } from './types.js'
export function createProvider(profile: Profile, options: { home?: string; fetch?: OAuthFetch } = {}): ProviderClient {
  if (profile.model.auth === 'codex_oauth') {
    return createCodexProvider(profile.model.id, { ...options,
      timeoutMs: profile.model.codex.request_timeout_ms,
      reasoningEffort: profile.model.codex.reasoning_effort,
    })
  }
  return createApiKeyProvider(profile, createApiClient(profile))
}
