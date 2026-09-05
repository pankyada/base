/** Cancel only this waiter; shared operations keep their own lifetime. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(signal.reason ?? new DOMException('Operation aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason ?? new DOMException('Operation aborted', 'AbortError')) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

export function lifetime(timeoutMs: number, signal?: AbortSignal, label = 'Operation') {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs)
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      controller.abort()
    },
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout>
  return abortable(new Promise<void>(resolve => { timer = setTimeout(resolve, ms) }), signal)
    .finally(() => clearTimeout(timer))
}

export async function boundedJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Provider response body missing')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > 512 * 1024) throw new Error('Provider response exceeds size limit')
      chunks.push(value)
    }
    signal?.throwIfAborted()
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new Error('Provider response contained invalid JSON') }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
