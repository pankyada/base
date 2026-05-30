import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CronScheduler } from '../src/scheduler/cron.js'
import type { Profile } from '../src/profiles/schema.js'
import type { RunStore } from '../src/runs/store.js'

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}))

vi.mock('../src/server/run-profile.js', () => ({
  runProfileOnce: vi.fn().mockResolvedValue({
    finalText: 'done',
    usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 },
    session: { id: 'sess1' },
  }),
}))

const BASE_PROFILE: Profile = {
  name: 'test',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
  system_prompt: './prompt.md',
  artifact_dir: '/tmp',
  tools: { builtin: {} as any, custom: {}, mcp_servers: [] },
  hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
  improvement: { enabled: false, mine_skills_every_n_sessions: 10 },
  max_depth: 2,
  agents: [],
  memory: { provider: 'fs' },
  working_dir: '/tmp',
}

function makeMockRunStore(): RunStore {
  return {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    list: vi.fn().mockReturnValue([]),
    scanRunning: vi.fn().mockReturnValue([]),
  } as any
}

describe('CronScheduler', () => {
  let mockRunStore: RunStore
  let abortRegistry: Map<string, AbortController>

  beforeEach(() => {
    mockRunStore = makeMockRunStore()
    abortRegistry = new Map()
    vi.clearAllMocks()
  })

  it('does not register a cron job when triggers is undefined', async () => {
    const cron = await import('node-cron')
    const scheduler = new CronScheduler(BASE_PROFILE, mockRunStore, abortRegistry)
    scheduler.init()
    expect(cron.default.schedule).not.toHaveBeenCalled()
  })

  it('does not register a cron job when triggers.cron is undefined', async () => {
    const cron = await import('node-cron')
    const profile = { ...BASE_PROFILE, triggers: { webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()
    expect(cron.default.schedule).not.toHaveBeenCalled()
  })

  it('registers a cron job when triggers.cron is set', async () => {
    const cron = await import('node-cron')
    const profile = { ...BASE_PROFILE, triggers: { cron: '0 9 * * *', webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()
    expect(cron.default.schedule).toHaveBeenCalledWith('0 9 * * *', expect.any(Function))
  })

  it('stop() calls task.stop()', async () => {
    const cron = await import('node-cron')
    const mockTask = { stop: vi.fn() }
    vi.mocked(cron.default.schedule).mockReturnValue(mockTask as any)
    const profile = { ...BASE_PROFILE, triggers: { cron: '* * * * *', webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()
    scheduler.stop()
    expect(mockTask.stop).toHaveBeenCalled()
  })

  it('cron callback creates run record and calls runProfileOnce', async () => {
    const cron = await import('node-cron')
    const { runProfileOnce } = await import('../src/server/run-profile.js')
    let capturedCallback: (() => Promise<void>) | null = null
    vi.mocked(cron.default.schedule).mockImplementation((_expr, cb) => {
      capturedCallback = cb as () => Promise<void>
      return { stop: vi.fn() } as any
    })

    const profile = { ...BASE_PROFILE, triggers: { cron: '* * * * *', webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()

    expect(capturedCallback).not.toBeNull()
    await capturedCallback!()

    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'cron', status: 'running', profile: 'test',
    }))
    expect(runProfileOnce).toHaveBeenCalled()
    expect(mockRunStore.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'completed' })
    )
  })
})
