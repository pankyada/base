import { describe, expect, it, vi, afterEach } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'
import { createWebSearchTool } from '../src/tools/builtin/web-search.js'
import { createBraveProvider } from '../src/tools/web/brave.js'
import { clearRegistry, resolveTool } from '../src/tools/registry.js'
import { registerAll } from '../src/tools/builtin/index.js'

const profile = (apiKeyEnv?: string) => ({
  name: 'search',
  model: { base_url: 'https://example.com', api_key_env: 'MODEL_KEY', id: 'model' },
  system_prompt: '/tmp/prompt',
  artifact_dir: '/tmp/artifacts',
  tools: { web_search: apiKeyEnv ? { api_key_env: apiKeyEnv } : undefined },
}) as any

const context = (overrides: Record<string, unknown> = {}) => ({
  profile: profile('BRAVE_KEY'),
  ...overrides,
}) as any

describe('Brave search provider', () => {
  it('maps the Brave response to the provider contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      web: { results: [{ title: 'Docs', url: 'https://example.com/docs', description: 'Useful docs' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const provider = createBraveProvider('secret', fetchImpl)

    await expect(provider.search('harness', 3)).resolves.toEqual([
      { title: 'Docs', url: 'https://example.com/docs', snippet: 'Useful docs' },
    ])
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(String(fetchImpl.mock.calls[0][0])).toContain('q=harness')
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ 'x-subscription-token': 'secret' })
  })

  it('surfaces provider HTTP errors for the tool boundary to handle', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 503 }))
    await expect(createBraveProvider('secret', fetchImpl).search('harness', 3))
      .rejects.toThrow('HTTP 503')
  })
})

describe('WebSearch tool', () => {
  afterEach(() => {
    clearRegistry()
    vi.unstubAllEnvs()
  })

  it('returns untrusted results and degrades provider failures to an error string', async () => {
    vi.stubEnv('BRAVE_KEY', 'secret')
    const provider = { name: 'stub', search: vi.fn().mockResolvedValue([{ title: 'Result', url: 'https://example.com', snippet: 'Snippet' }]) }
    const tool = createWebSearchTool(() => provider)
    const result = await tool.execute({ query: 'test', limit: 1 }, context())

    expect(result).toMatchObject({ provenance: 'untrusted', source: 'Brave Search', effect: 'outbound' })
    expect((result as any).content).toContain('Result')
    expect(provider.search).toHaveBeenCalledWith('test', 1)

    provider.search.mockRejectedValueOnce(new Error('upstream down'))
    await expect(tool.execute({ query: 'test' }, context())).resolves.toBe('Error: WebSearch failed: upstream down')
  })

  it('returns a controlled error when the profile has no key', async () => {
    const tool = createWebSearchTool(() => ({ name: 'unused', search: vi.fn() }))
    await expect(tool.execute({ query: 'test' }, context({ profile: profile() })))
      .resolves.toBe('Error: WebSearch is not configured (missing API key)')
  })

  it('does not register without a key and registers with a configured key', () => {
    const configured = profile('BRAVE_KEY')
    registerAll(undefined, profile())
    expect(resolveTool('WebSearch')).toBeUndefined()

    vi.stubEnv('BRAVE_KEY', 'secret')
    registerAll(undefined, configured)
    expect(resolveTool('WebSearch')).toBeDefined()
  })

  it('parses the profile key environment setting', () => {
    const parsed = ProfileSchema.parse({
      name: 'search',
      model: { base_url: 'https://example.com', api_key_env: 'MODEL_KEY', id: 'model' },
      system_prompt: '/tmp/prompt',
      artifact_dir: '/tmp/artifacts',
      tools: { web_search: { api_key_env: 'BRAVE_KEY' } },
    })
    expect(parsed.tools.web_search?.api_key_env).toBe('BRAVE_KEY')
  })
})
