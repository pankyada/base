import { resolve, dirname } from 'path'
import { homedir } from 'os'
import { Ajv } from 'ajv'
import type { Profile } from '../profiles/schema.js'
import type { ToolDefinition, ToolContext } from '../tools/types.js'
import { runSubAgent } from './runner.js'
import { buildDelegateFanoutTool } from '../tools/builtin/delegate-fanout.js'

function untildify(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p
}

function resolvePath(p: string, profile: Profile): string {
  if (p === '$CWD') return process.cwd()
  return resolve(profile.profile_path ? dirname(profile.profile_path) : process.cwd(), untildify(p))
}

export type AgentExecutor = (input: Record<string, unknown>, context: ToolContext) => Promise<string>

export async function loadAgentTools(profile: Profile): Promise<ToolDefinition[]> {
  if (!profile.agents || profile.agents.length === 0) return []

  const ajv = new Ajv()
  const executors = new Map<string, AgentExecutor>()
  const tools: ToolDefinition[] = []

  for (const entry of profile.agents) {
    if (executors.has(entry.name)) {
      throw new Error(`Duplicate agent name "${entry.name}" in profile "${profile.name}"`)
    }

    const subProfilePath = resolvePath(entry.profile, profile)
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

  tools.push(buildDelegateFanoutTool(executors, new Map(profile.agents.map(entry => [entry.name, entry.spawn ?? {}]))))
  return tools
}
