import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { writeCodexCredential } from '../src/provider/auth/store.js'
import { readUserConfig } from '../src/config/user-config.js'
import { userEnvPath } from '../src/config/user-env.js'
import { runInit, type InitDoctor, type InitIO } from '../src/cli/init.js'

function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'harness-init-'))
  const profiles = join(home, '.harness', 'profiles')
  mkdirSync(profiles, { recursive: true })
  writeFileSync(join(profiles, 'prompt.md'), '# prompt')
  writeFileSync(join(profiles, 'coding.yaml'), `name: coding
use_case:
  label: Coding
  blurb: Write code
  rank: 1
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ./prompt.md
artifact_dir: ./artifacts
`)
  return home
}

function io(lines: string[], answers: string[], secret = 'sk-test-secret'): InitIO {
  return {
    write: line => lines.push(line),
    readLine: async () => answers.shift() ?? '',
    readSecret: async () => secret,
  }
}

const doctor: InitDoctor = async () => ({ ok: true, checks: [] })

describe('harness init', () => {
  it('switches to Codex only after a profile diff, preserves keys, and migrates helper models', async () => {
    const home = fixtureHome()
    try {
      const path = join(home, '.harness', 'profiles', 'coding.yaml')
      writeFileSync(path, readFileSync(path, 'utf8') + 'models:\n  roles:\n    cheap: gpt-4o\nsafety:\n  classifier_model_id: gpt-4o\n')
      const lines: string[] = []
      const environment = { OPENAI_API_KEY: 'ambient-canary' }
      const input = io(lines, ['1', '4', 'gpt-5.4-mini', 'y', '1'])
      input.readSecret = async () => { throw new Error('Codex must not ask for an API key') }
      expect(await runInit(['--offline'], { homeDir: home, environment, io: input, doctor })).toBe(0)
      const result = readFileSync(path, 'utf8')
      expect(result).toContain('auth: codex_oauth')
      expect(result).toContain('cheap: gpt-5.4-mini')
      expect(result).toContain('classifier_model_id: gpt-5.4-mini')
      expect(result).not.toContain('api_key_env:')
      expect(environment.OPENAI_API_KEY).toBe('ambient-canary')
      expect(lines.join('\n')).toContain('Helper model changes:')
      expect(lines.join('\n')).not.toContain('ambient-canary')
      expect(readUserConfig(home)?.default_profile).toBe('coding')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('writes config and env non-interactively with defaults', async () => {
    const home = fixtureHome()
    try {
      const lines: string[] = []
      const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'ambient', PATH: join(home, '.local', 'bin') }
      expect(await runInit(['--yes', '--offline'], { homeDir: home, environment, io: io(lines, []), doctor })).toBe(0)
      expect(readUserConfig(home)).toMatchObject({ default_profile: 'coding', surface: 'tui' })
      expect(existsSync(userEnvPath(home))).toBe(false)
      expect(lines.join('\n')).not.toContain('ambient')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('masks a typed key and never writes it to output', async () => {
    const home = fixtureHome()
    try {
      const lines: string[] = []
      const environment: NodeJS.ProcessEnv = { PATH: join(home, '.local', 'bin') }
      expect(await runInit(['--offline'], { homeDir: home, environment, io: io(lines, ['', '', '', '']), doctor })).toBe(0)
      expect(readFileSync(userEnvPath(home), 'utf-8')).toContain('OPENAI_API_KEY=sk-test-secret')
      expect(lines.join('\n')).not.toContain('sk-test-secret')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('does not rewrite a profile model without explicit confirmation', async () => {
    const home = fixtureHome()
    try {
      const profilePath = join(home, '.harness', 'profiles', 'coding.yaml')
      const before = readFileSync(profilePath, 'utf-8')
      const lines: string[] = []
      const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'ambient', PATH: join(home, '.local', 'bin') }
      const answers = ['1', '2', 'gpt-4o-mini', 'n', '1']
      expect(await runInit(['--offline'], { homeDir: home, environment, io: io(lines, answers), doctor })).toBe(0)
      expect(readFileSync(profilePath, 'utf-8')).toBe(before)
      expect(lines.join('\n')).toContain('model change declined')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})

it('onboards legacy profiles without use_case metadata without rewriting the profile', async () => {
  const home = fixtureHome()
  try {
    const path = join(home, '.harness', 'profiles', 'coding.yaml')
    const legacy = readFileSync(path, 'utf8').replace(/use_case:\n(?:  .*\n)+/, '')
    writeFileSync(path, legacy)
    const lines: string[] = []
    expect(await runInit(['--yes', '--offline'], { homeDir: home, environment: { OPENAI_API_KEY: 'fixture-key' }, io: io(lines, []), doctor })).toBe(0)
    expect(readUserConfig(home)?.default_profile).toBe('coding')
    expect(readFileSync(path, 'utf8')).toBe(legacy)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

it('shows every provider model and selects beyond the first twelve', async () => {
  const home = fixtureHome()
  const models = Array.from({ length: 20 }, (_, i) => ({ id: `provider-model-${i + 1}` }))
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: models }), { headers: { 'content-type': 'application/json' } }))
  try {
    const lines: string[] = []
    expect(await runInit([], { homeDir: home, environment: { OPENAI_API_KEY: 'fixture-key' }, io: io(lines, ['1', '2', '20', 'y', '1']), doctor })).toBe(0)
    expect(lines.join('\n')).toContain('20. provider-model-20')
    expect(readFileSync(join(home, '.harness/profiles/coding.yaml'), 'utf8')).toContain('id: provider-model-20')
  } finally { fetchMock.mockRestore(); rmSync(home, { recursive: true, force: true }) }
})

it('accepts a custom model ID instead of silently reverting to the default', async () => {
  const home = fixtureHome()
  try {
    expect(await runInit(['--offline'], { homeDir: home, environment: { OPENAI_API_KEY: 'fixture-key' }, io: io([], ['1', '2', 'my-custom-model', 'y', '1']), doctor })).toBe(0)
    expect(readFileSync(join(home, '.harness/profiles/coding.yaml'), 'utf8')).toContain('id: my-custom-model')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

it('loads every Anthropic page before selection', async () => {
  const home = fixtureHome()
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'claude-first' }], has_more: true, last_id: 'claude-first' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'claude-last' }], has_more: false })))
  try {
    expect(await runInit([], { homeDir: home, environment: { ANTHROPIC_API_KEY: 'fixture-key' }, io: io([], ['1', '1', '2', 'y', '1']), doctor })).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('after_id=claude-first')
    expect(readFileSync(join(home, '.harness/profiles/coding.yaml'), 'utf8')).toContain('id: claude-last')
  } finally { fetchMock.mockRestore(); rmSync(home, { recursive: true, force: true }) }
})

it('requests the Codex catalog with a protocol version and displays selectable slugs', async () => {
  const home = fixtureHome()
  await writeCodexCredential({ kind: 'codex_oauth', access_token: 'fixture-token', refresh_token: 'fixture-refresh', account_id: 'fixture-account', expires_at: Date.now() + 3600000 }, home)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input))
    if (url.searchParams.get('client_version') !== '0.153.4') return new Response('missing client_version', { status: 400 })
    return new Response(JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list' }, { slug: 'internal-review', visibility: 'hide' }, { slug: 'gpt-5.6-sol', visibility: 'list' }] }))
  })
  try {
    const lines: string[] = []
    expect(await runInit([], { homeDir: home, environment: {}, io: io(lines, ['1', '4', '2', 'y', '1']), doctor })).toBe(0)
    expect(lines.join('\n')).toContain('gpt-6-astra')
    expect(lines.join('\n')).not.toContain('internal-review')
    expect(readFileSync(join(home, '.harness/profiles/coding.yaml'), 'utf8')).toContain('id: gpt-5.6-sol')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  } finally { fetchMock.mockRestore(); rmSync(home, { recursive: true, force: true }) }
})
