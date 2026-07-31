import { describe, expect, it, vi } from 'vitest'
import { classify } from '../src/safety/classifier.js'
import { DangerCache, verdictKey } from '../src/safety/cache.js'

function context(openai: any, safety: any = {}): any {
  return {
    profile: { name: 'safety', model: { id: 'gpt-4o', base_url: 'https://api.openai.com/v1' }, safety },
    session: { id: 's1' }, workingDir: '/tmp/work', openai,
  }
}

describe('danger classifier', () => {
  it('does not call model for safe or statically dangerous inputs', async () => {
    const create = vi.fn()
    const openai = { chat: { completions: { create } } }
    expect((await classify('Read', { file_path: 'src/a.ts' }, context(openai))).source).toBe('static')
    expect((await classify('Bash', { command: 'rm -rf build' }, context(openai))).source).toBe('static')
    expect(create).not.toHaveBeenCalled()
  })

  it('returns model verdict and caches it', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"risk":"caution","reason":"needs review"}' } }] })
    const ctx = context({ chat: { completions: { create } } }, { cache_ttl_hours: 168 })
    const first = await classify('Bash', { command: 'find . -name tmp -delete' }, ctx)
    const second = await classify('Bash', { command: 'find . -name tmp -delete' }, ctx)
    expect(first.source).toBe('model')
    expect(second.source).toBe('cache')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('fails closed on malformed classifier output', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'not json' } }] })
    const result = await classify('Bash', { command: 'find . -delete' }, context({ chat: { completions: { create } } }, { cache_ttl_hours: 0 }))
    expect(result).toEqual({ risk: 'danger', reason: 'classification unavailable', source: 'failsafe' })
  })

  it('fails closed when classifier aborts', async () => {
    const create = vi.fn((_request: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const result = await classify('Bash', { command: 'find . -delete' }, context({ chat: { completions: { create } } }, { timeout_ms: 5, cache_ttl_hours: 0 }))
    expect(result.risk).toBe('danger')
    expect(result.source).toBe('failsafe')
  })
})

describe('danger cache', () => {
  it('canonicalizes object key order and evicts expired entries', () => {
    let now = 1000
    const cache = new DangerCache('/tmp/harness-danger-cache-test.json', () => now)
    expect(verdictKey('Bash', { a: 1, b: 2 })).toBe(verdictKey('Bash', { b: 2, a: 1 }))
    cache.set('k', { risk: 'caution', reason: 'review' })
    expect(cache.get('k', 1)).toMatchObject({ risk: 'caution' })
    now += 60 * 60 * 1000 + 1
    expect(cache.get('k', 1)).toBeUndefined()
  })
})
