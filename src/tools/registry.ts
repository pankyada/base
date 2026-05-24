import { ToolDefinition } from './types.js'

const registry = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  registry.set(tool.name, tool)
}

export function resolveTool(name: string): ToolDefinition | undefined {
  return registry.get(name)
}

export function getAllTools(): ToolDefinition[] {
  return [...registry.values()]
}

export function clearRegistry(): void {
  registry.clear()
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}
