import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'

export function createProviderClient(profile: Profile): OpenAI {
  const apiKey = process.env[profile.model.api_key_env]
  if (!apiKey) {
    throw new Error(
      `Provider API key missing: set env var ${profile.model.api_key_env}`
    )
  }
  return new OpenAI({
    baseURL: profile.model.base_url,
    apiKey,
  })
}
