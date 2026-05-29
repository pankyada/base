import type { ToolDefinition, ToolContext } from '../types.js'

type AgentExecutor = (input: Record<string, unknown>, context: ToolContext) => Promise<string>

export function buildDelegateFanoutTool(
  executors: Map<string, AgentExecutor>
): ToolDefinition {
  const agentList = [...executors.keys()].join(', ')

  return {
    name: 'DelegateFanout',
    description:
      `Run multiple named sub-agents in parallel and collect all results. ` +
      `Available agents: ${agentList || '(none)'}. ` +
      `Failed tasks return an error field; successful tasks return an output field.`,
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'List of sub-agent tasks to run in parallel.',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string', description: 'Sub-agent name' },
              input: { type: 'object', description: "Input matching the agent's declared input schema" },
            },
            required: ['agent', 'input'],
          },
        },
      },
      required: ['tasks'],
    },
    async execute(rawInput, context) {
      const { tasks } = rawInput as { tasks: Array<{ agent: string; input: Record<string, unknown> }> }

      const results = await Promise.all(
        tasks.map(async ({ agent, input }) => {
          const executor = executors.get(agent)
          if (!executor) {
            return { agent, error: `Unknown agent "${agent}". Available: ${agentList || '(none)'}` }
          }
          try {
            const outputStr = await executor(input, context)
            if (outputStr.startsWith('Error:')) {
              return { agent, error: outputStr }
            }
            return { agent, output: JSON.parse(outputStr) }
          } catch (e: any) {
            return { agent, error: e.message }
          }
        })
      )

      return JSON.stringify({ results })
    },
  }
}
