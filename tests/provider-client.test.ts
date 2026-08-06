import { afterEach, describe, expect, it } from 'vitest'
import { clearProviderClientPool, createProviderClient } from '../src/provider/client.js'

describe('provider client pool', () => {
  afterEach(() => { clearProviderClientPool(); delete process.env.TEST_PROVIDER_KEY })

  it('shares clients only when base URL and resolved key match', () => {
    process.env.TEST_PROVIDER_KEY = 'one'
    const base = { model: { base_url: 'https://api.example.test/v1', api_key_env: 'TEST_PROVIDER_KEY', id: 'model' } } as any
    const same = { model: { ...base.model, id: 'other-model' } } as any
    const first = createProviderClient(base)
    expect(first).toBe(createProviderClient(same))
    process.env.TEST_PROVIDER_KEY = 'two'
    const second = createProviderClient(base)
    expect(second).not.toBe(first)
    expect(second).toBe(createProviderClient(same))
  })
})
