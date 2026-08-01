export function applyCacheBreakpoints(messages: unknown[], enabled: boolean): unknown[] {
  if (!enabled) return messages
  const result = messages.map(message => ({ ...(message as any) })) as any[]
  if (result.length > 0) result[0] = { ...result[0], cache_control: { type: 'ephemeral' } }
  if (result[1]?.content?.startsWith('[Earlier session digest:')) {
    result[1] = { ...result[1], cache_control: { type: 'ephemeral' } }
  }
  return result
}
