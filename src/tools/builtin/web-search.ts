import type { Profile } from '../../profiles/schema.js'
import { createBraveProvider } from '../web/brave.js'
import type { SearchProvider, SearchResult } from '../web/provider.js'
import type { ToolDefinition } from '../types.js'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20

export type SearchProviderFactory = (apiKey: string, profile: Profile) => SearchProvider

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No web search results.'
  return results.map((result, index) =>
    `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`
  ).join('\n\n')
}

export function createWebSearchTool(factory: SearchProviderFactory = (apiKey) => createBraveProvider(apiKey)): ToolDefinition {
  return {
    name: 'WebSearch',
    description: 'Search the web and return ranked untrusted results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum results (default 5, max 20)' },
      },
      required: ['query'],
    },
    async execute(input, context) {
      const { query, limit = DEFAULT_LIMIT } = input as { query?: unknown; limit?: unknown }
      if (typeof query !== 'string' || !query.trim()) return 'Error: WebSearch query must be a non-empty string'
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) return 'Error: WebSearch limit must be a positive integer'

      const apiKeyEnv = context.profile.tools?.web_search?.api_key_env
      const apiKey = apiKeyEnv ? process.env[apiKeyEnv]?.trim() : undefined
      if (!apiKey) return 'Error: WebSearch is not configured (missing API key)'

      try {
        const results = await factory(apiKey, context.profile).search(query, Math.min(limit, MAX_LIMIT))
        return {
          content: formatResults(results),
          provenance: 'untrusted',
          source: 'Brave Search',
          effect: 'outbound',
        }
      } catch (error) {
        return `Error: WebSearch failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }
}

export const webSearchTool = createWebSearchTool()
