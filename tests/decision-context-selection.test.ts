import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { clearRegistry, registerTool } from '../src/tools/registry.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'

async function* completed() {
  yield {
    type: 'done' as const,
    result: { text: 'done', toolCalls: [], finishReason: 'stop' as const },
  }
}

function profile() {
  return {
    name: 'decision-fixture',
    model: { id: 'fixture-model', auth: 'api_key', base_url: 'https://example.test/v1', api_key_env: 'FIXTURE_KEY' },
    tools: { builtin: { Relevant: 'allow', Irrelevant: 'allow' }, mcp_servers: [] },
    safety: { enabled: false },
  } as any
}

function context(session: any, stream: ReturnType<typeof vi.fn>, decisionRuntime?: unknown, profileValue = profile(), skills: any[] = []) {
  return {
    profile: profileValue,
    session,
    workingDir: '/tmp',
    memory: { buildSystemPromptSection: async () => '' },
    skills,
    mcpEntries: [],
    delegateDepth: 0,
    provider: {
      kind: 'api_key',
      model: 'fixture-model',
      stream,
    },
    ...(decisionRuntime === undefined ? {} : { decisionRuntime }),
  } as any
}

function events() {
  return {
    onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(),
    onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(),
  } as any
}

function tool(name: string) {
  return { name, description: name, parameters: { type: 'object' }, execute: vi.fn(async () => `${name} result`) }
}

describe('decision context selection at the provider boundary', () => {
  afterEach(() => clearRegistry())

  it('keeps the disabled baseline payload unchanged', async () => {
    const relevant = tool('Relevant')
    const irrelevant = tool('Irrelevant')
    registerTool(relevant)
    registerTool(irrelevant)
    const session = createSession('decision-fixture', 'fixture-user')
    const stream = vi.fn(async function* () { yield* completed() })
    const ctx = context(session, stream)
    await runAgentLoop('inspect the relevant thing', profile(), session, ctx, events(), undefined, new AbortController().signal)
    const request = (stream.mock.calls as any[])[0][0]
    expect(request.tools.map((entry: any) => entry.name)).toEqual(['Relevant', 'Irrelevant'])
  })

  it('narrows enforce-mode schemas while retaining the full executor registry', async () => {
    registerTool(tool('Relevant'))
    registerTool(tool('Irrelevant'))
    const selection = {
      selectCapabilities: vi.fn().mockResolvedValue({
        mode: 'enforce',
        selectedSkillNames: [],
        selectedToolNames: ['Relevant'],
        fallback: 'none',
        revision: 'fixture-revision',
      }),
    }
    const session = createSession('decision-fixture', 'fixture-user')
    const stream = vi.fn(async function* () { yield* completed() })
    const ctx = context(session, stream, selection)
    await runAgentLoop('inspect the relevant thing', profile(), session, ctx, events(), undefined, new AbortController().signal)
    expect(selection.selectCapabilities).toHaveBeenCalledOnce()
    const request = (stream.mock.calls as any[])[0][0]
    expect(request.tools.map((entry: any) => entry.name)).toEqual(['Relevant'])
  })

  it('keeps shadow mode identical to disabled payloads', async () => {
    registerTool(tool('Relevant'))
    registerTool(tool('Irrelevant'))
    const selection = {
      selectCapabilities: vi.fn().mockResolvedValue({
        mode: 'shadow',
        selectedSkillNames: [],
        selectedToolNames: ['Relevant'],
        fallback: 'none',
        revision: 'fixture-revision',
      }),
    }
    const session = createSession('decision-fixture', 'fixture-user')
    const stream = vi.fn(async function* () { yield* completed() })
    const ctx = context(session, stream, selection)
    await runAgentLoop('inspect the relevant thing', profile(), session, ctx, events(), undefined, new AbortController().signal)
    const request = (stream.mock.calls as any[])[0][0]
    expect(request.tools.map((entry: any) => entry.name)).toEqual(['Relevant', 'Irrelevant'])
  })

  it('exposes bounded discovery and refreshes selection after an omitted capability is requested', async () => {
    registerTool(tool('Relevant'))
    registerTool(tool('Irrelevant'))
    const selection = {
      selectCapabilities: vi.fn()
        .mockResolvedValueOnce({ mode: 'enforce', selectedSkillNames: [], selectedToolNames: ['Relevant'], fallback: 'none', revision: 'r1', discovery: { name: 'CapabilityDiscovery', description: 'discover', parameters: { type: 'object' } } })
        .mockResolvedValueOnce({ mode: 'enforce', selectedSkillNames: [], selectedToolNames: ['Irrelevant'], fallback: 'none', revision: 'r2', discovery: { name: 'CapabilityDiscovery', description: 'discover', parameters: { type: 'object' } } }),
    }
    const streams: any[] = []
    const stream = vi.fn(async function* () {
      if (streams.length === 0) {
        streams.push(true)
        yield { type: 'done' as const, result: { text: '', toolCalls: [{ id: 'disc-1', name: 'CapabilityDiscovery', arguments: '{"query":"other"}' }], finishReason: 'tool_calls' as const } }
      } else {
        yield { type: 'done' as const, result: { text: 'done', toolCalls: [], finishReason: 'stop' as const } }
      }
    })
    const session = createSession('decision-fixture', 'fixture-user')
    const ctx = context(session, stream, selection)
    await runAgentLoop('inspect the relevant thing', profile(), session, ctx, events(), undefined, new AbortController().signal)
    expect(selection.selectCapabilities).toHaveBeenCalledTimes(2)
    expect((stream.mock.calls as any[])[0][0].tools.map((entry: any) => entry.name)).toEqual(['Relevant', 'CapabilityDiscovery'])
    expect((stream.mock.calls as any[])[1][0].tools.map((entry: any) => entry.name)).toEqual(['Irrelevant', 'CapabilityDiscovery'])
  })

  it('omits statically denied tools from the enforce selection catalog and schemas', async () => {
    registerTool(tool('Relevant'))
    registerTool(tool('Irrelevant'))
    const configured = profile()
    configured.tools.builtin.Irrelevant = 'deny'
    const selection = {
      selectCapabilities: vi.fn().mockResolvedValue({ mode: 'enforce', selectedSkillNames: [], selectedToolNames: ['Relevant'], fallback: 'none', revision: 'acl' }),
    }
    const session = createSession('decision-fixture', 'fixture-user')
    const stream = vi.fn(async function* () { yield* completed() })
    const ctx = context(session, stream, selection, configured)
    await runAgentLoop('inspect the relevant thing', configured, session, ctx, events(), undefined, new AbortController().signal)
    const selectionInput = selection.selectCapabilities.mock.calls[0][0]
    expect(selectionInput.tools.map((entry: any) => entry.name)).toEqual(['Relevant'])
    expect((stream.mock.calls as any[])[0][0].tools.map((entry: any) => entry.name)).toEqual(['Relevant'])
  })

  it('rechecks conditional retention tools when a disabled profile follows an enabled registry', async () => {
    registerTool(tool('MemoryRestore'))
    registerTool(tool('MemoryReview'))
    const configured = profile()
    configured.decision_layer = { enabled: false, features: { memory_retention: 'enforce' } }
    const session = createSession('decision-fixture', 'fixture-user')
    const stream = vi.fn(async function* () { yield* completed() })
    const ctx = context(session, stream, undefined, configured)
    await runAgentLoop('inspect the relevant thing', configured, session, ctx, events(), undefined, new AbortController().signal)
    expect((stream.mock.calls as any[])[0][0].tools.map((entry: any) => entry.name)).not.toContain('MemoryRestore')
    expect((stream.mock.calls as any[])[0][0].tools.map((entry: any) => entry.name)).not.toContain('MemoryReview')
  })

  it('keeps selected skill bodies inside the configured context window', async () => {
    registerTool(tool('Relevant'))
    const configured = profile()
    configured.context = { max_tokens: 100 }
    const selection = {
      selectCapabilities: vi.fn().mockResolvedValue({ mode: 'enforce', selectedSkillNames: ['huge-skill'], selectedToolNames: ['Relevant'], fallback: 'none', revision: 'budget' }),
    }
    const session = createSession('decision-fixture', 'fixture-user')
    session.messages.push({ role: 'system', content: 'Base system prompt.' })
    const stream = vi.fn(async function* () { yield* completed() })
    const ctx = context(session, stream, selection, configured, [{ name: 'huge-skill', description: 'large', content: 'x'.repeat(5_000), filePath: '/tmp/huge' }])
    await runAgentLoop('inspect the relevant thing', configured, session, ctx, events(), undefined, new AbortController().signal)
    const request = (stream.mock.calls as any[])[0][0]
    expect(JSON.stringify(request.messages)).not.toContain('x'.repeat(500))
    expect(request.messages.reduce((sum: number, message: unknown) => sum + JSON.stringify(message).length, 0)).toBeLessThan(400)
  })
})
