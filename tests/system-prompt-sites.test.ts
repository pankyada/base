import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  systemMessages: [] as string[],
  loadProfile: vi.fn(),
  runAgentLoop: vi.fn(),
}))

vi.mock('../src/context/project-context.js', () => ({
  loadProjectContext: () => '\nPROJECT-CONTEXT\n',
}))
vi.mock('../src/loop/agent-loop.js', () => ({ runAgentLoop: state.runAgentLoop }))
vi.mock('../src/mcp/client.js', () => ({
  createMcpClients: vi.fn().mockResolvedValue([]),
  destroyMcpClients: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/skills/loader.js', () => ({
  loadAllSkills: vi.fn().mockReturnValue([]),
  resolveSkillsDirs: vi.fn().mockReturnValue([]),
}))
vi.mock('../src/skills/indexer.js', () => ({ buildSkillIndex: vi.fn().mockReturnValue('\nSKILLS\n') }))
vi.mock('../src/provider/client.js', () => ({ createProviderClient: vi.fn().mockReturnValue({}) }))
vi.mock('../src/usage/ledger.js', () => ({ recordUsage: vi.fn() }))
vi.mock('../src/agents/loader.js', () => ({ loadAgentTools: vi.fn().mockResolvedValue([]) }))
vi.mock('../src/profiles/loader.js', () => ({
  loadProfile: state.loadProfile,
  systemPromptFor: (profile: { system_prompt: string }) => profile.system_prompt,
}))
vi.mock('../src/memory/fs-memory.js', () => ({
  FsMemoryProvider: vi.fn().mockImplementation(function () {
    return { buildSystemPromptSection: vi.fn().mockResolvedValue('\nMEMORY\n') }
  }),
}))
vi.mock('../src/memory/graph-memory.js', () => ({
  GraphMemoryProvider: vi.fn().mockImplementation(function () {
    return { buildSystemPromptSection: vi.fn().mockResolvedValue('\nMEMORY\n') }
  }),
}))

import { runSubAgent } from '../src/agents/runner.js'
import { buildInteractiveSystemPrompt } from '../src/server/interactive-prompt.js'
import { runProfileOnce } from '../src/server/run-profile.js'

const events = {
  onToken: vi.fn(),
  onToolStart: vi.fn(),
  onToolEnd: vi.fn(),
  onToolPrompt: vi.fn().mockResolvedValue(true),
  onSessionEnd: vi.fn(),
  onStats: vi.fn(),
}

describe('project context in system prompts', () => {
  let root: string
  let promptPath: string
  const profile = {
    name: 'test',
    model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
    system_prompt: '',
    context: { project_files: true },
    artifact_dir: '/tmp',
    working_dir: '/tmp',
    max_depth: 2,
    agents: [],
    tools: { builtin: {}, mcp_servers: [] },
    hooks: { pre_tool: [], post_tool: [], on_stop: [] },
    improvement: { enabled: false },
  } as any

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-prompt-sites-'))
    promptPath = join(root, 'prompt.md')
    writeFileSync(promptPath, 'BASE-PROMPT')
    profile.system_prompt = promptPath
    state.systemMessages.length = 0
    state.loadProfile.mockReset().mockReturnValue({ ...profile, name: 'sub' })
    state.runAgentLoop.mockReset().mockImplementation(async (_input, _profile, session: any) => {
      state.systemMessages.push(session.messages[0].content)
      session.messages.push({ role: 'assistant', content: JSON.stringify({ result: 'ok' }) })
    })
  })

  it('assembles identical project context for interactive, delegated, and REST paths', async () => {
    const memory = { buildSystemPromptSection: vi.fn().mockResolvedValue('\nMEMORY\n') } as any
    const interactive = await buildInteractiveSystemPrompt(profile, false, '\nSKILLS\n', memory)

    await runSubAgent({
      agentName: 'sub',
      subProfilePath: promptPath,
      inputValidator: (() => true) as any,
      outputValidator: (() => true) as any,
      outputSchema: {},
      input: { request: 'test' },
      context: {
        profile,
        session: { user: 'test', messages: [], tool_calls: [] } as any,
        workingDir: '/tmp', memory, skills: [], mcpEntries: [], events,
        openai: {} as any, delegateDepth: 0, maxDepth: 2, agentTools: [],
      },
    })
    const delegated = state.systemMessages.at(-1)

    await runProfileOnce({
      profile,
      userId: 'test',
      userMessage: 'test',
      events,
    })
    const rest = state.systemMessages.at(-1)

    expect(interactive).toBe('BASE-PROMPT\nPROJECT-CONTEXT\n\nSKILLS\n\nMEMORY\n')
    expect(delegated).toBe(interactive)
    expect(rest).toBe(interactive)
  })

  it('omits project context when the profile kill switch is disabled', async () => {
    const memory = { buildSystemPromptSection: vi.fn().mockResolvedValue('') } as any
    const disabled = await buildInteractiveSystemPrompt(
      { ...profile, context: { project_files: false } },
      false,
      '',
      memory,
    )

    expect(disabled).toBe('BASE-PROMPT')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))
})
