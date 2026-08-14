import type { SearchProvider, SearchResult } from './provider.js'

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

export type BraveFetch = typeof fetch

export function createBraveProvider(apiKey: string, fetchImpl: BraveFetch = fetch): SearchProvider {
  return {
    name: 'brave',
    async search(query, limit): Promise<SearchResult[]> {
      const endpoint = new URL(BRAVE_ENDPOINT)
      endpoint.searchParams.set('q', query)
      endpoint.searchParams.set('count', String(limit))
      const response = await fetchImpl(endpoint, {
        headers: {
          accept: 'application/json',
          'x-subscription-token': apiKey,
        },
      })
      if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}`)
      const payload = await response.json() as { web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> } }
      return (payload.web?.results ?? []).flatMap(result => {
        if (typeof result.title !== 'string' || typeof result.url !== 'string') return []
        return [{
          title: result.title,
          url: result.url,
          snippet: typeof result.description === 'string' ? result.description : '',
        }]
      }).slice(0, limit)
    },
  }
}
