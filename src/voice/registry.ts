import type { VoiceProvider } from './types.js'

const providers = new Map<string, VoiceProvider>()
export function registerVoiceProvider(provider: VoiceProvider): void { providers.set(provider.name, provider) }
export function resolveVoiceProvider(name: string): VoiceProvider | undefined { return providers.get(name) }
export function clearVoiceProviders(): void { providers.clear() }
