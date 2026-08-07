import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { clearRegistry, registerTool } from '../src/tools/registry.js'
import { listAudit } from '../src/audit/query.js'
import { audit } from '../src/audit/journal.js'

async function* stream(chunks: unknown[]) { for (const chunk of chunks) yield chunk }

describe('audit journal', () => {
  beforeEach(() => clearRegistry())
  afterEach(() => {
    clearRegistry()
    vi.unstubAllEnvs()
  })

  it('writes exactly one complete audit entry per effectful tool call', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-audit-'))
    vi.stubEnv('HOME', home)
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')
    registerTool({ name: 'CustomWrite', description: 'effectful one', parameters: { type: 'object' }, execute: first })
    registerTool({ name: 'CustomNotify', description: 'effectful two', parameters: { type: 'object' }, execute: second })
    const session = createSession('audit-profile', 'alice')
    const profile: any = {
      name: 'audit-profile', model: { id: 'model', base_url: '', api_key_env: '' },
      tools: { builtin: {}, custom: { '*': 'allow' }, mcp_servers: [] }, artifact_dir: home, working_dir: home,
    }
    const openai: any = { chat: { completions: { create: vi.fn()
      .mockReturnValueOnce(stream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'w1', function: { name: 'CustomWrite', arguments: '{}' } }, { index: 1, id: 'n1', function: { name: 'CustomNotify', arguments: '{}' } }] } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      ]))
      .mockReturnValueOnce(stream([
        { choices: [{ delta: { content: 'done' } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      ])) } } }

    await runAgentLoop('run', profile, session, {
      profile, session, workingDir: home, memory: new FsMemoryProvider(home, session), skills: [], approvalMode: 'yolo', runId: 'run-1',
    } as any, { onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onToolPrompt: vi.fn(), onSessionEnd: vi.fn() }, openai)

    const entries = listAudit('alice').filter(entry => entry.run_id === 'run-1')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(entries).toHaveLength(2)
    expect(entries.every(entry => entry.decided_reason.length > 0)).toBe(true)
    expect(new Set(entries.map(entry => entry.tool))).toEqual(new Set(['CustomWrite', 'CustomNotify']))
  })

  it('redacts sensitive input before journaling', () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-audit-redact-'))
    vi.stubEnv('HOME', home)
    const entry = audit({
      run_id: 'run-2', session_id: 's', user: 'alice', profile: 'p', tool: 'Notify',
      input: { password: 'secret-value' }, effect: 'outbound', decision: 'allow', decided_by: 'default',
      decided_reason: 'test reason', tainted: false, ok: true,
    })
    expect(entry.input_digest).toMatch(/^[a-f0-9]{16}$/)
    expect(entry.decided_reason).toBe('test reason')
  })
})
