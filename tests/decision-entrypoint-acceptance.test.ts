import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DecisionLayerSchema } from '../src/decisions/types.js'
import { clearRegistry, registerTool } from '../src/tools/registry.js'
import { runProfileOnce } from '../src/server/run-profile.js'
import { buildDecisionSkillIndex } from '../src/context/system-prompt.js'
import type { ProviderClient, ProviderEvent, ProviderRequest } from '../src/provider/types.js'

type Case = {
  root: string
  server: Server
  endpoint: string
  jevRequests: Array<Record<string, any>>
  mainRequests: ProviderRequest[]
}

const envKeys = ['BASE_DECISION_ENTRYPOINT_KEY', 'JEV_DECISION_ENTRYPOINT_KEY'] as const
const previousEnv = new Map(envKeys.map(key => [key, process.env[key]]))

async function fixture(mode: 'enforce' | 'shadow', answer: 'sufficient' | 'needs-verification' = 'sufficient'): Promise<Case> {
  const jevRequests: Array<Record<string, any>> = []
  const mainRequests: ProviderRequest[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>
    jevRequests.push(body)
    const answers = Object.fromEntries(Object.entries(body.questions as Record<string, any>).map(([id, question]) => {
      if (question.type === 'score') {
        const index = Number(id.split('_').at(-1))
        const key = Array.isArray(body.state?.candidates) ? body.state.candidates[index]?.key : ''
        const score = String(key).includes('release') ? 1 : 0
        return [id, { type: 'score', score, legend: { '0': question.criteria[0], '1': question.criteria[1] }, probabilities: { '0': score === 0 ? 1 : 0, '1': score === 1 ? 1 : 0 }, confidence: 0.95 }]
      }
      const labels = Object.keys(question.criteria)
      const choice = labels.includes(answer) ? answer : labels[0]
      return [id, { type: 'choice', choice, probabilities: Object.fromEntries(labels.map(label => [label, label === choice ? 1 : 0])), confidence: answer === 'needs-verification' ? 0.2 : 0.95 }]
    }))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 10, output_tokens: 2 } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind')
  const root = mkdtempSync(join(tmpdir(), 'base-jev-entrypoint-'))
  const prompt = join(root, 'system.md')
  writeFileSync(prompt, 'You are a test assistant.')
  process.env.BASE_DECISION_ENTRYPOINT_KEY = 'main-fixture-key'
  process.env.JEV_DECISION_ENTRYPOINT_KEY = 'jev-fixture-key'

  const tool = {
    name: 'EntryRead',
    description: 'Read the fixture release status.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => 'release status: ready',
  }
  registerTool(tool)

  return { root, server, endpoint: `http://127.0.0.1:${address.port}/v1/systemone`, jevRequests, mainRequests }
}

function profile(root: string, endpoint: string, mode: 'enforce' | 'shadow', deny = false) {
  return {
    name: `entrypoint-${mode}`,
    model: { id: 'main-fixture', auth: 'api_key', base_url: 'http://127.0.0.1:1/v1', api_key_env: 'BASE_DECISION_ENTRYPOINT_KEY' },
    system_prompt: join(root, 'system.md'), artifact_dir: root, working_dir: root,
    memory: { provider: 'fs' }, max_depth: 1, agents: [],
    tools: { builtin: { EntryRead: deny ? 'deny' : 'allow' }, mcp_servers: [] },
    safety: { enabled: false },
    decision_layer: DecisionLayerSchema.parse({
      enabled: true, endpoint, model: 'jev-fixture', api_key_env: 'JEV_DECISION_ENTRYPOINT_KEY', allow_remote_state: true,
      features: { result_verification: mode },
      limits: { max_calls: 4, max_response_bytes: 32_000 },
      price: { input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0 },
    }),
  } as any
}

function mainProvider(requests: ProviderRequest[]): ProviderClient {
  let calls = 0
  const provider: ProviderClient = {
    kind: 'api_key', model: 'main-fixture',
    generate: async () => ({ text: '', toolCalls: [], finishReason: 'stop' as const }),
    stream: async function* (request: ProviderRequest): AsyncIterable<ProviderEvent> {
      requests.push(request)
      calls++
      if (calls === 1) {
        yield { type: 'done', result: { text: '', toolCalls: [{ id: 'entry-call-1', name: 'EntryRead', arguments: '{}' }], finishReason: 'tool_calls' } }
      } else {
        yield { type: 'done', result: { text: 'finished', toolCalls: [], finishReason: 'stop' } }
      }
    },
  }
  return provider
}

function events() {
  return {
    onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onToolPrompt: async () => true,
    onSessionEnd: () => {}, onEvidence: (...args: unknown[]) => evidence.push(args), onNotice: (...args: unknown[]) => notices.push(args),
  }
}

let evidence: unknown[][] = []
let notices: unknown[][] = []

afterEach(async () => {
  clearRegistry()
  evidence = []
  notices = []
  for (const key of envKeys) {
    const value = previousEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('mounted decision entry point', () => {
  it('keeps the skill index when the global decision switch is off', () => {
    const configuredButDisabled = DecisionLayerSchema.parse({ enabled: false, allow_remote_state: true, features: { capability_selection: 'enforce' } })
    const index = buildDecisionSkillIndex({ decision_layer: configuredButDisabled } as any, [{ name: 'fixture-skill', description: 'fixture', content: 'fixture body', filePath: '/tmp/fixture' }])
    expect(index).toContain('fixture-skill')
  })

  it('creates the configured advisory from profile and appends one enforce hint to the next model request', async () => {
    const mounted = await fixture('enforce')
    try {
      const result = await runProfileOnce({ profile: profile(mounted.root, mounted.endpoint, 'enforce'), userId: 'entry-user', userMessage: 'check the release', events: events(), provider: mainProvider(mounted.mainRequests) })
      expect(result.finalText).toBe('finished')
      expect(mounted.jevRequests).toHaveLength(1)
      expect(Object.keys(mounted.jevRequests[0].questions)).toEqual(['assessment'])
      expect(mounted.mainRequests).toHaveLength(2)
      const next = mounted.mainRequests[1].messages.at(-1)
      expect(next).toMatchObject({ role: 'tool', tool_call_id: 'entry-call-1' })
      expect(String(next?.content)).toContain('[Decision advisory entry-call-1: sufficient]')
      expect(String(next?.content).match(/Decision advisory entry-call-1/g)).toHaveLength(1)
      expect(evidence).toHaveLength(1)
      expect(evidence[0].slice(0, 6)).toEqual(['entry-call-1', 'EntryRead', {}, 'release status: ready', true, 'trusted'])
    } finally {
      mounted.server.close()
      rmSync(mounted.root, { recursive: true, force: true })
    }
  })

  it('keeps shadow output and notices baseline-compatible while still making one advisory call', async () => {
    const mounted = await fixture('shadow')
    try {
      const result = await runProfileOnce({ profile: profile(mounted.root, mounted.endpoint, 'shadow'), userId: 'entry-user', userMessage: 'check the release', events: events(), provider: mainProvider(mounted.mainRequests) })
      expect(result.finalText).toBe('finished')
      expect(mounted.jevRequests).toHaveLength(1)
      expect(mounted.mainRequests).toHaveLength(2)
      const next = mounted.mainRequests[1].messages.at(-1)
      expect(String(next?.content)).toBe('release status: ready')
      expect(evidence[0].slice(0, 6)).toEqual(['entry-call-1', 'EntryRead', {}, 'release status: ready', true, 'trusted'])
      expect(notices).toEqual([])
    } finally {
      mounted.server.close()
      rmSync(mounted.root, { recursive: true, force: true })
    }
  })

  it('falls back on an ordinary Jev response failure without changing executor evidence', async () => {
    const mounted = await fixture('enforce')
    mounted.server.removeAllListeners('request')
    mounted.server.on('request', (_request, response) => { response.writeHead(500); response.end('temporary') })
    try {
      const result = await runProfileOnce({ profile: profile(mounted.root, mounted.endpoint, 'enforce'), userId: 'entry-user', userMessage: 'check the release', events: events(), provider: mainProvider(mounted.mainRequests) })
      expect(result.finalText).toBe('finished')
      expect(mounted.mainRequests[1].messages.at(-1)).toMatchObject({ role: 'tool', content: 'release status: ready' })
      expect(evidence[0].slice(0, 6)).toEqual(['entry-call-1', 'EntryRead', {}, 'release status: ready', true, 'trusted'])
    } finally {
      mounted.server.close()
      rmSync(mounted.root, { recursive: true, force: true })
    }
  })

  it('does not send a result advisory for a denied tool call', async () => {
    const mounted = await fixture('enforce')
    try {
      const result = await runProfileOnce({ profile: profile(mounted.root, mounted.endpoint, 'enforce', true), userId: 'entry-user', userMessage: 'check the release', events: events(), provider: mainProvider(mounted.mainRequests) })
      expect(result.finalText).toBe('finished')
      expect(mounted.jevRequests).toHaveLength(0)
      expect(evidence).toHaveLength(0)
      expect(mounted.mainRequests[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'entry-call-1' })
      expect(String(mounted.mainRequests[1].messages.at(-1)?.content)).toContain('denied by profile ACL')
    } finally {
      mounted.server.close()
      rmSync(mounted.root, { recursive: true, force: true })
    }
  })

  it('mounts enforced memory recall into the initial prompt selection', async () => {
    const mounted = await fixture('enforce')
    const configured = profile(mounted.root, mounted.endpoint, 'enforce')
    configured.decision_layer.features = { memory_recall: 'enforce' }
    mkdirSync(join(mounted.root, 'memory'), { recursive: true })
    writeFileSync(join(mounted.root, 'memory', 'other.md'), 'Unrelated stored fact.')
    writeFileSync(join(mounted.root, 'memory', 'release.md'), 'Known release status is ready.')
    try {
      const result = await runProfileOnce({ profile: configured, userId: 'entry-user', userMessage: 'check the release', events: events(), provider: mainProvider(mounted.mainRequests) })
      expect(result.finalText).toBe('finished')
      expect(mounted.jevRequests.some(request => Object.keys(request.questions).some(key => key.startsWith('candidate_')))).toBe(true)
      const initial = String(mounted.mainRequests[0].messages[0]?.content)
      expect(initial).toContain('release')
      expect(initial).not.toContain('Unrelated stored fact.')
    } finally {
      mounted.server.close()
      rmSync(mounted.root, { recursive: true, force: true })
    }
  })
})
