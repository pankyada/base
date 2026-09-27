import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { clearRegistry, registerTool } from '../src/tools/registry.js'
import { createMcpClients, getMcpToolDefinitions } from '../src/mcp/client.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { effectFor, isGatedEffect } from '../src/tools/effects.js'
import type { McpEntry } from '../src/mcp/client.js'
import type { Profile } from '../src/profiles/schema.js'

const profile = { tools: { mcp_servers: [{ name: 'documents' }] } } as unknown as Profile
function definition(annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean; destructiveHint?: boolean }) {
  const entries = [{ serverName: 'documents', client: {}, tools: [{ name: 'memory_graph', description: 'Local graph lookup', inputSchema: {}, annotations }] }] as unknown as McpEntry[]
  return getMcpToolDefinitions(profile, entries)[0]
}

describe('closed-world read-only MCP effects', () => {
  it('preserves listTools annotations when establishing an MCP connection', async () => {
    const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    const connect = vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined)
    const listTools = vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [{ name: 'memory_graph', inputSchema: { type: 'object' }, annotations }] })
    try {
      const p = { tools: { mcp_servers: [{name:'documents',transport:'stdio',command:process.execPath,args:[],env:{}}] } } as unknown as Profile
      const entries = await createMcpClients(p)
      expect(entries[0].tools[0].annotations).toEqual(annotations)
      expect(getMcpToolDefinitions(p, entries)[0].effect).toBe('read')
    } finally {
      connect.mockRestore()
      listTools.mockRestore()
    }
  })
  it('declares read effects before execution for closed-world non-destructive reads', () => {
    const tool = definition({ readOnlyHint: true, openWorldHint: false, destructiveHint: false })
    expect(tool).toHaveProperty('effect', 'read')
    expect(isGatedEffect(effectFor(tool.name, true, (tool as any).effect))).toBe(false)
  })

  it.each([
    undefined,
    {},
    { readOnlyHint: true },
    { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    { readOnlyHint: true, openWorldHint: false, destructiveHint: true },
  ])('does not downgrade unknown, open-world or contradictory hints: %j', annotations => {
    const tool = definition(annotations)
    expect(tool).not.toHaveProperty('effect', 'read')
    expect(isGatedEffect(effectFor(tool.name, true, (tool as any).effect))).toBe(true)
  })

  it('allows another closed-world read after taint while still gating outbound calls', async () => {
    clearRegistry()
    const session = createSession('memorybank', 'test-user')
    const dir = mkdtempSync(join(tmpdir(), 'mcp-read-effects-'))
    const notify = vi.fn().mockResolvedValue('sent')
    registerTool({ name: 'Notify', description: 'outbound', parameters: {}, execute: notify })
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'untrusted source evidence' }] })
    const entries = [{serverName:'documents',client:{callTool},tools:[
      {name:'search_documents',description:'Search',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false,destructiveHint:false}},
      {name:'memory_graph',description:'Graph',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false,destructiveHint:false}},
    ]}]
    const p:any={name:'memorybank',model:{id:'gpt-4o',base_url:'',api_key_env:''},
      safety:{gate_untrusted_actions:true},tools:{builtin:{Notify:'allow'},custom:{},mcp_servers:[{name:'documents',acl:{'*':'allow'}}]},
      hooks:{pre_tool:[],post_tool:[],on_stop:[]},improvement:{enabled:false}}
    async function* chunks(items:any[]) {for(const item of items) yield item}
    const calls=['documents__search_documents','documents__memory_graph','Notify']
    const openai={chat:{completions:{create:vi.fn().mockReturnValueOnce(chunks(calls.map((name,index)=>({choices:[{delta:{tool_calls:[{index,id:'t'+index,function:{name,arguments:'{}'}}]}}]})))).mockReturnValueOnce(chunks([{choices:[{delta:{content:'done'}}]}]))}}}
    const prompt=vi.fn().mockResolvedValue(false)
    await runAgentLoop('search then inspect graph',p,session,{profile:p,session,workingDir:dir,memory:new FsMemoryProvider(dir,session),skills:[],mcpEntries:entries,approvalMode:'yolo'} as any,
      {onToken:vi.fn(),onToolStart:vi.fn(),onToolEnd:vi.fn(),onToolPrompt:prompt,onSessionEnd:vi.fn()},openai as any)
    expect(callTool.mock.calls.map(args=>args[0].name)).toEqual(['search_documents','memory_graph'])
    expect(session.taint_sources?.length).toBeGreaterThan(0)
    expect(notify).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalledWith('t2','Notify',{},undefined,expect.stringContaining('MCP documents__search_documents'))
  })
})
