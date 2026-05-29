import { describe, it, expect, vi } from 'vitest'
import { buildDelegateFanoutTool } from '../src/tools/builtin/delegate-fanout.js'
import type { ToolContext } from '../src/tools/types.js'

function makeContext(): ToolContext {
  return {
    profile: {} as any,
    session: {} as any,
    workingDir: '/tmp',
    memory: {} as any,
    skills: [],
    mcpEntries: [],
    events: {
      onToken: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onToolPrompt: vi.fn().mockResolvedValue(true),
      onSessionEnd: vi.fn(),
    },
    openai: {} as any,
    delegateDepth: 0,
    maxDepth: 2,
    agentTools: [],
  }
}

describe('buildDelegateFanoutTool', () => {
  it('returns error result for unknown agent names', async () => {
    const tool = buildDelegateFanoutTool(new Map())
    const result = await tool.execute(
      { tasks: [{ agent: 'unknown', input: {} }] },
      makeContext()
    )
    const parsed = JSON.parse(result)
    expect(parsed.results[0].agent).toBe('unknown')
    expect(parsed.results[0].error).toContain('Unknown agent')
  })

  it('runs known agents in parallel and returns all results', async () => {
    const order: string[] = []
    const executors = new Map<string, (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>>([
      ['researcher', async (input) => {
        order.push('researcher')
        return JSON.stringify({ findings: `found: ${(input as any).query}` })
      }],
      ['writer', async (input) => {
        order.push('writer')
        return JSON.stringify({ content: `wrote: ${(input as any).topic}` })
      }],
    ])

    const tool = buildDelegateFanoutTool(executors)
    const result = await tool.execute(
      {
        tasks: [
          { agent: 'researcher', input: { query: 'climate' } },
          { agent: 'writer', input: { topic: 'climate report' } },
        ],
      },
      makeContext()
    )

    const parsed = JSON.parse(result)
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results.find((r: any) => r.agent === 'researcher').output).toEqual({ findings: 'found: climate' })
    expect(parsed.results.find((r: any) => r.agent === 'writer').output).toEqual({ content: 'wrote: climate report' })
    expect(order).toHaveLength(2)
  })

  it('isolates failures — failed task gets error, successful task gets output', async () => {
    const executors = new Map<string, (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>>([
      ['good', async () => JSON.stringify({ ok: true })],
      ['bad', async () => 'Error: something broke'],
    ])

    const tool = buildDelegateFanoutTool(executors)
    const result = await tool.execute(
      { tasks: [{ agent: 'good', input: {} }, { agent: 'bad', input: {} }] },
      makeContext()
    )

    const parsed = JSON.parse(result)
    expect(parsed.results.find((r: any) => r.agent === 'good').output).toEqual({ ok: true })
    expect(parsed.results.find((r: any) => r.agent === 'bad').error).toContain('something broke')
  })
})
