import type { ToolDefinition, ToolContext } from '../types.js'
import { runBoundedPool } from '../../agents/pool.js'

type AgentExecutor = (input: Record<string, unknown>, context: ToolContext) => Promise<string>
type AgentSpawnConfig = { max_concurrent?: number }

export function buildDelegateFanoutTool(
  executors: Map<string, AgentExecutor>,
  spawnConfigs: Map<string, AgentSpawnConfig> = new Map(),
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

      const settled = await runBoundedPool(
        tasks.map(({ agent, input }) => ({
          key: agent,
          maxConcurrent: spawnConfigs.get(agent)?.max_concurrent,
          run: async childContext => {
            const executor = executors.get(agent)
            if (!executor) return { agent, error: `Unknown agent "${agent}". Available: ${agentList || '(none)'}` }
            const outputStr = await executor(input, childContext)
            if (outputStr.startsWith('Error:')) return { agent, error: outputStr }
            return { agent, output: JSON.parse(outputStr) }
          },
        })),
        context,
        3,
      )
      const results = settled.map((result, index) => result.status === 'fulfilled'
        ? result.value
        : { agent: tasks[index].agent, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })

      return JSON.stringify({ results })
    },
  }
}
