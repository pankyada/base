import { describe, expect, it, beforeEach, vi } from 'vitest'
import { resolveAcl, resolveAclDecision, resolveAclDecisionWithMemory } from '../src/tools/acl.js'
import { stageAcl } from '../src/workflow/stage-acl.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { clearRegistry, registerTool } from '../src/tools/registry.js'
import { EFFECTS, effectFor, isMutatingEffect } from '../src/tools/effects.js'
import type { Stage } from '../src/workflow/types.js'

const stages: Stage[] = ['recon', 'plan', 'design', 'build', 'verify', 'review']
const modes = ['strict', 'bash', 'danger', 'yolo'] as const
const readOnlyTools = ['Write', 'Edit', 'Bash', 'ExecuteCode', 'Delegate', 'MemoryDelete']
const effectTools = Object.keys(EFFECTS)

const profile: any = {
  name: 'stage-acl',
  model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
  tools: { builtin: { WebFetch: 'allow', WebSearch: 'allow' }, mcp_servers: [] },
  hooks: { pre_tool: [], post_tool: [], on_stop: [] },
  improvement: { enabled: false },
}

describe('stage ACL overlays', () => {
  beforeEach(() => clearRegistry())

  it('denies mutation across every read-only stage and mode', async () => {
    const memory = { read: vi.fn().mockResolvedValue(null) } as any
    for (const stage of stages) {
      const overlay = stageAcl(stage)
      for (const mode of modes) {
        for (const tool of readOnlyTools) {
          const expected = stage === 'build' || stage === 'verify' || stage === 'review' ? undefined : 'deny'
          expect(overlay[tool]).toBe(expected)
          const sync = resolveAclDecision(tool, {}, profile, mode, undefined, overlay)
          const asyncDecision = await resolveAclDecisionWithMemory(tool, {}, profile, memory, mode, undefined, overlay)
          expect(sync.value).toBe(expected ?? resolveAcl(tool, profile, mode, undefined, overlay))
          expect(asyncDecision.value).toBe(expected ?? resolveAcl(tool, profile, mode, undefined, overlay))
        }
        for (const tool of effectTools) {
          const expected = isMutatingEffect(effectFor(tool)) && stage !== 'build' && stage !== 'verify' && stage !== 'review'
            ? 'deny'
            : resolveAcl(tool, profile, mode)
          expect(overlay[tool]).toBe(stage === 'recon' || stage === 'plan' || stage === 'design'
            ? (isMutatingEffect(effectFor(tool)) ? 'deny' : undefined)
            : undefined)
          expect(resolveAcl(tool, profile, mode, undefined, overlay)).toBe(expected)
        }
      }
    }
  })

  it('denies DelegateFanout from the generated stage overlay', () => {
    expect(EFFECTS.DelegateFanout).toBe('destructive')
    expect(stageAcl('plan').DelegateFanout).toBe('deny')
  })

  it('leaves normal ACL behavior unchanged without a stage overlay', () => {
    expect(resolveAcl('Write', profile, 'yolo')).toBe('allow')
    expect(resolveAcl('Write', profile, 'yolo', undefined, stageAcl('build'))).toBe('allow')
  })

  it('blocks Write through the agent loop during a yolo plan stage', async () => {
    const session = createSession('stage-acl', 'testuser')
    const executed = vi.fn().mockResolvedValue('written')
    registerTool({ name: 'Write', description: 'write', parameters: {}, execute: executed })
    async function* stream(chunks: any[]) {
      for (const chunk of chunks) yield chunk
    }
    const openai = {
      chat: { completions: { create: vi.fn()
        .mockReturnValueOnce(stream([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'plan-write', function: { name: 'Write', arguments: '{"path":"x","content":"bad"}' } }] } }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
        ]))
        .mockReturnValueOnce(stream([
          { choices: [{ delta: { content: 'plan complete' } }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
        ])) } },
    }

    await runAgentLoop('make a plan', profile, session, {
      profile, session, workingDir: process.cwd(), memory: new FsMemoryProvider(process.cwd(), session), skills: [], approvalMode: 'yolo',
    } as any, {
      onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn(),
    }, openai as any, undefined, {
      stage: { task_id: 'task', stage_id: 'stage', stage: 'plan', attempt: 1, intensity: 1, tier: 'cheap' },
    })

    expect(executed).not.toHaveBeenCalled()
    expect((session.messages as any[]).find(message => message.role === 'tool')?.content).toContain('denied by profile ACL')
  })
})
