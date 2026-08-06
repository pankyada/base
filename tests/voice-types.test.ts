import { describe, expect, it } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'
import { clearVoiceProviders, registerVoiceProvider, resolveVoiceProvider } from '../src/voice/registry.js'

describe('voice extension surface', () => {
  it('keeps provider config opaque and registers no core provider', () => {
    const profile = ProfileSchema.parse({ name: 'voice', model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' }, system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art', voice: { stt: { provider: 'fixture', config: { key_env: 'VOICE_KEY' } } } })
    expect(profile.voice?.stt).toEqual({ provider: 'fixture', config: { key_env: 'VOICE_KEY' } })
    clearVoiceProviders(); registerVoiceProvider({ name: 'fixture', stt: { name: 'fixture', async *transcribe() {} } })
    expect(resolveVoiceProvider('fixture')?.name).toBe('fixture')
  })
})
