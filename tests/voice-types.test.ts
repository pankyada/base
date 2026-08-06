import { describe, expect, it } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'
import { clearVoiceProviders, registerVoiceProvider, resolveVoiceProvider } from '../src/voice/registry.js'
import { fixtureVoiceProvider } from '../src/voice/fixture.js'

describe('voice extension surface', () => {
  it('keeps provider config opaque and registers no core provider', () => {
    const profile = ProfileSchema.parse({ name: 'voice', model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' }, system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art', voice: { stt: { provider: 'fixture', config: { key_env: 'VOICE_KEY' } } } })
    expect(profile.voice?.stt).toEqual({ provider: 'fixture', config: { key_env: 'VOICE_KEY' } })
    clearVoiceProviders(); registerVoiceProvider({ name: 'fixture', stt: { name: 'fixture', async *transcribe() {} } })
    expect(resolveVoiceProvider('fixture')?.name).toBe('fixture')
  })
})

describe('fixture voice provider', () => {
  it('streams deterministic transcript and audio without a vendor dependency', async () => {
    async function* audio() { yield new TextEncoder().encode('hello') }
    const transcript: Array<{ text: string; final: boolean }> = []
    for await (const part of fixtureVoiceProvider.stt!.transcribe(audio(), { codec: 'pcm16', sample_rate: 16_000 })) transcript.push(part)
    async function* text() { yield 'hello.' }
    const audioOut: Uint8Array[] = []
    for await (const part of fixtureVoiceProvider.tts!.synthesize(text(), { sample_rate: 24_000 })) audioOut.push(part)
    expect(transcript.at(-1)).toEqual({ text: 'hello', final: true })
    expect(new TextDecoder().decode(audioOut[0])).toBe('hello.')
  })
})
