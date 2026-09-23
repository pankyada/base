import { describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/session/store.js'
import { executeStage } from '../src/workflow/runner.js'
import type { Playbook } from '../src/workflow/types.js'

// PT-076 (roadmap #31 phase 1): executeStage must use the *passed* playbook's
// contract()/name, not re-resolve `profile.workflow?.playbook` internally.
// This drives executeStage directly (it is exported from runner.ts for
// exactly this purpose — see the comment above its definition) with a
// playbook object that deliberately differs from the profile's configured
// `workflow.playbook`, and a fake loop that reports what the caller passed
// it as the stage's `playbook` tag.

function profile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'fixture',
    model: { id: 'default', base_url: '', api_key_env: '' },
    artifact_dir: '/tmp/workflow-execute-stage-tests',
    working_dir: process.cwd(),
    workflow: { playbook: 'coding', knowledge: { graph: false, generalization_probe: true } }, // deliberately NOT the playbook we pass in
    models: { roles: { cheap: 'cheap', balanced: 'balanced', frontier: 'frontier', critic: 'critic' } },
    ...overrides,
  }
}

const memory: any = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null), write: vi.fn() }
const events: any = {
  onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStage: vi.fn(),
}

function context(profileValue: any, session: any): any {
  return { profile: profileValue, session, workingDir: process.cwd(), memory, skills: [], mcpEntries: [], events, openai: {}, delegateDepth: 0 }
}

describe('executeStage playbook threading (PT-076)', () => {
  it('uses the passed playbook, not profile.workflow.playbook, for the contract and stage tag', async () => {
    const customPlaybook: Playbook = {
      name: 'custom-test-playbook',
      description: 'not the profile playbook',
      stages: ['recon', 'plan', 'design', 'build', 'verify', 'review'],
      task_classes: ['general'],
      defaults: {},
      contract: () => ({ required_sections: ['Custom Marker'], exit_criteria: 'custom exit criteria', prompt: 'custom prompt' }),
    }

    const p = profile()
    const session = createSession(p.name, 'test')
    let observedPlaybookTag: string | undefined
    let observedSeed = ''
    const loop = vi.fn(async (seed: string, _profile: any, staged: any, _ctx: any, _events: any, _openai: any, _signal: any, opts: any) => {
      observedPlaybookTag = opts.stage.playbook
      observedSeed = seed
      staged.messages.push({ role: 'assistant', content: '## Custom Marker\nsatisfied' })
    })

    const plan = { task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 1, design: 0, build: 0, verify: 0, review: 0 }, confidence: 0.9, why: 'test' }

    const result = await executeStage(
      'do the thing', 'plan', 1, 'cheap', 1, 'task-1', plan as any,
      p, customPlaybook, session, context(p, session), events, undefined,
      new AbortController().signal, [], '', loop, false, false,
    )

    // The stage tag handed to the agent loop carries the passed playbook's
    // name, not profile.workflow.playbook ('coding').
    expect(observedPlaybookTag).toBe('custom-test-playbook')
    // The contract's required section (only known to customPlaybook.contract)
    // made it into the seed prompt built from it.
    expect(observedSeed).toContain('Custom Marker')
    // Validation ran against the passed playbook's contract, so the
    // fake-loop's matching body satisfies it.
    expect(result.contract_ok).toBe(true)
  })
})
