import { resolve } from 'path'
import { homedir } from 'os'
import { Ajv } from 'ajv'
import type { Profile } from '../profiles/schema.js'
import type { ToolDefinition, ToolContext } from '../tools/types.js'
import { runSubAgent } from './runner.js'
import { buildDelegateFanoutTool } from '../tools/builtin/delegate-fanout.js'

function resolvePath(p: string): string {
  if (p.startsWith('~')) return resolve(p.replace('~', homedir()))
  return resolve(p)
}

type AgentExecutor = (input: Record<string, unknown>, context: ToolContext) => Promise<string>

export async function loadAgentTools(profile: Profile): Promise<ToolDefinition[]> {
  if (!profile.agents || profile.agents.length === 0) return []

  const ajv = new Ajv()
  const executors = new Map<string, AgentExecutor>()
  const tools: ToolDefinition[] = []

  for (const entry of profile.agents) {
    const subProfilePath = resolvePath(entry.profile)
    const inputValidator = ajv.compile(entry.input)
    const outputValidator = ajv.compile(entry.output)

    const executor: AgentExecutor = (input, context) =>
      runSubAgent({
        agentName: entry.name,
        subProfilePath,
        inputValidator,
        outputValidator,
        outputSchema: entry.output as Record<string, unknown>,
        input,
        context,
      })

    executors.set(entry.name, executor)

    tools.push({
      name: entry.name,
      description:
        `Sub-agent "${entry.name}". Accepts: ${JSON.stringify(entry.input)}. ` +
        `Returns: ${JSON.stringify(entry.output)}.`,
      parameters: entry.input as Record<string, unknown>,
      execute: executor,
    })
  }

  tools.push(buildDelegateFanoutTool(executors))
  return tools
}
