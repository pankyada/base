import { describe, it, expect, beforeEach } from 'vitest'
import { registerTool, resolveTool, clearRegistry, getAllTools } from '../src/tools/registry.js'
import { ToolDefinition } from '../src/tools/types.js'

const fakeTool: ToolDefinition = {
  name: 'FakeTool',
  description: 'test',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => 'result',
}

beforeEach(() => clearRegistry())

describe('registry', () => {
  it('registers and resolves tool', () => {
    registerTool(fakeTool)
    expect(resolveTool('FakeTool')).toBe(fakeTool)
  })
  it('returns undefined for unknown tool', () => {
    expect(resolveTool('Nope')).toBeUndefined()
  })
  it('getAllTools returns all registered', () => {
    registerTool(fakeTool)
    expect(getAllTools()).toHaveLength(1)
  })
})
