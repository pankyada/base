import type { ChannelAdapter } from './types.js'

const registry = new Map<string, ChannelAdapter>()

export function registerChannel(adapter: ChannelAdapter): void {
  registry.set(adapter.name, adapter)
}

export function resolveChannel(name: string): ChannelAdapter | undefined {
  return registry.get(name)
}

export function getAllChannels(): ChannelAdapter[] {
  return [...registry.values()]
}

export function clearChannelRegistry(): void {
  registry.clear()
}

