import type { Profile } from '../profiles/schema.js'
import type { OAuthFetch } from './auth/oauth.js'
import type { EffortCapability } from '../types.js'
import { createProviderClient as createApiClient } from './client.js'
import { createApiKeyProvider } from './api-key.js'
import { createCodexProvider } from './codex/adapter.js'
import type { ProviderClient } from './types.js'
export function createProvider(profile: Profile, options: { home?: string; fetch?: OAuthFetch; effortCapability?: EffortCapability } = {}): ProviderClient {
  if (profile.model.auth === 'codex_oauth') {
    return createCodexProvider(profile.model.id, { ...options,
      timeoutMs: profile.model.codex.request_timeout_ms,
      reasoningEffort: profile.model.reasoning_effort ?? profile.model.codex.reasoning_effort,
      effortCapability: options.effortCapability,
    })
  }
  return createApiKeyProvider(profile, createApiClient(profile))
}
