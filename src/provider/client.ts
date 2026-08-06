import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'

const clients = new Map<string, OpenAI>()

/** Test seam; normal process lifetime intentionally shares compatible clients. */
export function clearProviderClientPool(): void { clients.clear() }

export function createProviderClient(profile: Profile): OpenAI {
  const apiKey = process.env[profile.model.api_key_env]
  if (!apiKey) {
    throw new Error(
      `Provider API key missing: set env var ${profile.model.api_key_env}`
    )
  }
  const cacheKey = `${profile.model.base_url}\u0000${apiKey}`
  const existing = clients.get(cacheKey)
  if (existing) return existing
  const client = new OpenAI({
    baseURL: profile.model.base_url,
    apiKey,
  })
  clients.set(cacheKey, client)
  return client
}
