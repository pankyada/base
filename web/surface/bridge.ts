export const FRAME_MESSAGES = new Set(['ui_result', 'ui_ready', 'console', 'surface_py_run', 'emit'])

export function acceptFrameMessage(event: { data?: unknown }, onMessage: (data: Record<string, unknown>) => void, log: (message: string) => void = () => undefined): boolean {
  const data = event.data
  if (!data || typeof data !== 'object' || typeof (data as { type?: unknown }).type !== 'string' || !FRAME_MESSAGES.has((data as { type: string }).type)) {
    log('dropped unknown surface message')
    return false
  }
  onMessage(data as Record<string, unknown>)
  return true
}
