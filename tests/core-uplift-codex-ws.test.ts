import { describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { writeCodexCredential } from '../src/provider/auth/store.js'

type Wire = Record<string, any>

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function nextType(socket: WebSocket, type: string): Promise<Wire> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const message = JSON.parse(String(raw)) as Wire
        if (message.type === type) { socket.off('message', onMessage); resolve(message) }
      } catch (error) { socket.off('message', onMessage); reject(error) }
    }
    socket.on('message', onMessage)
    socket.once('error', reject)
  })
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

async function waitForFile(path: string): Promise<void> {
  const started = Date.now()
  while (!existsSync(path)) {
    if (Date.now() - started > 5000) throw new Error(`fixture marker timeout: ${path}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function waitForFileContent(path: string, expected: string): Promise<void> {
  const started = Date.now()
  while (!existsSync(path) || readFileSync(path, 'utf8') !== expected) {
    if (Date.now() - started > 5000) throw new Error(`fixture content timeout: ${path}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('Core Codex discovery to payload over mounted WebSocket', () => {
  it('accepts a discovered future-model effort and sends it to Codex', async () => {
    const home = mkdtempSync(join(tmpdir(), `harness-codex-ws-${randomUUID()}-`))
    const profiles = join(home, '.harness', 'profiles'); mkdirSync(profiles, { recursive: true })
    const prompt = join(home, 'prompt.md'); writeFileSync(prompt, 'fixture prompt', 'utf8')
    const bodyFile = join(home, 'codex-request.json')
    writeFileSync(join(profiles, 'fixture.yaml'), [
      'name: fixture', 'model:', '  auth: codex_oauth', '  id: gpt-5.4-mini',
      `system_prompt: ${prompt}`, `artifact_dir: ${join(home, 'artifacts')}`, `working_dir: ${home}`,
    ].join('\n'), 'utf8')
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: Date.now() + 600_000, account_id: 'fixture-account' }, home)
    const port = 38000 + Math.floor(Math.random() * 1000)
    const preload = join(process.cwd(), 'tests/fixtures/codex-ws-fetch-preload.mjs')
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, HARNESS_PORT: String(port), HARNESS_PROFILE: 'fixture', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`, HARNESS_CODEX_FIXTURE_BODY_FILE: bodyFile }
    for (const key of ['HARNESS_DISABLE_CODEX_OAUTH', 'HARNESS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']) delete env[key]
    const child = spawn('pnpm', ['exec', 'tsx', 'src/server/index.ts'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk.toString() })
    child.stderr?.on('data', chunk => { output += chunk.toString() })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`startup timeout: ${output.slice(-1000)}`)), 15_000)
        const ready = () => { if (output.includes('Harness server on')) { clearTimeout(timer); resolve() } }
        child.stdout?.on('data', ready); child.stderr?.on('data', ready)
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output.slice(-1000)}`)) })
      })
      const socket = await open(`ws://127.0.0.1:${port}`)
      socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: 'fixture-user', profile: 'fixture' }))
      await nextType(socket, 'session_ready')
      socket.send(JSON.stringify({ type: 'set_model', model: '', effort: 'low', request_id: 'invalid-model' }))
      expect(await nextType(socket, 'notice')).toMatchObject({ message: 'model change refused', request_id: 'invalid-model' })
      socket.send(JSON.stringify({ type: 'set_model', model: 'gpt-future', effort: [], request_id: 'invalid-effort' }))
      expect(await nextType(socket, 'notice')).toMatchObject({ message: 'model effort change refused', request_id: 'invalid-effort' })
      socket.send(JSON.stringify({ type: 'models_list' }))
      const models = await nextType(socket, 'models')
      expect(models.models).toEqual([expect.objectContaining({ id: 'gpt-future', effort: expect.objectContaining({ status: 'supported' }) })])
      socket.send(JSON.stringify({ type: 'set_model', model: 'gpt-future', effort: 'low', request_id: 'future-model' }))
      expect(await nextType(socket, 'model_changed')).toMatchObject({ model: 'gpt-future', effort: 'low', request_id: 'future-model' })
      socket.send(JSON.stringify({ type: 'message', content: 'send fixture payload' }))
      expect(await nextType(socket, 'session_end')).toMatchObject({ status: 'completed' })
      const request = JSON.parse(readFileSync(bodyFile, 'utf8'))
      expect(request).toMatchObject({ model: 'gpt-future', reasoning: { effort: 'low' } })
      socket.close()
    } finally {
      await stop(child)
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects a catalog response when the Codex account changes during discovery', async () => {
    const home = mkdtempSync(join(tmpdir(), `harness-codex-race-${randomUUID()}-`))
    const profiles = join(home, '.harness', 'profiles'); mkdirSync(profiles, { recursive: true })
    writeFileSync(join(home, 'prompt.md'), 'fixture prompt', 'utf8')
    writeFileSync(join(profiles, 'fixture.yaml'), [
      'name: fixture', 'model:', '  auth: codex_oauth', '  id: gpt-5.4-mini',
      `system_prompt: ${join(home, 'prompt.md')}`, `artifact_dir: ${join(home, 'artifacts')}`, `working_dir: ${home}`,
    ].join('\n'), 'utf8')
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'old-access', refresh_token: 'old-refresh', expires_at: Date.now() + 600_000, account_id: 'old-account' }, home)
    const marker = join(home, 'models-started')
    const release = join(home, 'release-models')
    const done = join(home, 'models-done')
    const port = 39000 + Math.floor(Math.random() * 1000)
    const preload = join(process.cwd(), 'tests/fixtures/codex-ws-fetch-preload.mjs')
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, HARNESS_PORT: String(port), HARNESS_PROFILE: 'fixture', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`, HARNESS_CODEX_FIXTURE_MODELS_MARKER: marker, HARNESS_CODEX_FIXTURE_RELEASE_FILE: release, HARNESS_CODEX_FIXTURE_MODELS_DONE: done }
    for (const key of ['HARNESS_DISABLE_CODEX_OAUTH', 'HARNESS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']) delete env[key]
    const child = spawn('pnpm', ['exec', 'tsx', 'src/server/index.ts'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk.toString() })
    child.stderr?.on('data', chunk => { output += chunk.toString() })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`startup timeout: ${output.slice(-1000)}`)), 15_000)
        const ready = () => { if (output.includes('Harness server on')) { clearTimeout(timer); resolve() } }
        child.stdout?.on('data', ready); child.stderr?.on('data', ready)
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output.slice(-1000)}`)) })
      })
      const socket = await open(`ws://127.0.0.1:${port}`)
      socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: 'fixture-user', profile: 'fixture' }))
      await nextType(socket, 'session_ready')
      socket.send(JSON.stringify({ type: 'models_list' }))
      await waitForFile(marker)
      await writeCodexCredential({ kind: 'codex_oauth', access_token: 'new-access', refresh_token: 'new-refresh', expires_at: Date.now() + 600_000, account_id: 'new-account' }, home)
      writeFileSync(release, 'release', 'utf8')
      expect(await nextType(socket, 'notice')).toMatchObject({ message: 'model catalog changed while discovery was pending' })
      socket.close()
    } finally {
      await stop(child)
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps the newest concurrent model selection when discovery resolves out of order', async () => {
    const home = mkdtempSync(join(tmpdir(), `harness-codex-selection-race-${randomUUID()}-`))
    const profiles = join(home, '.harness', 'profiles'); mkdirSync(profiles, { recursive: true })
    writeFileSync(join(home, 'prompt.md'), 'fixture prompt', 'utf8')
    writeFileSync(join(profiles, 'fixture.yaml'), [
      'name: fixture', 'model:', '  auth: codex_oauth', '  id: gpt-5.4-mini',
      `system_prompt: ${join(home, 'prompt.md')}`, `artifact_dir: ${join(home, 'artifacts')}`, `working_dir: ${home}`,
    ].join('\n'), 'utf8')
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: Date.now() + 600_000, account_id: 'fixture-account' }, home)
    const marker = join(home, 'models-started')
    const release = join(home, 'release-models')
    const done = join(home, 'models-done')
    const port = 40000 + Math.floor(Math.random() * 1000)
    const preload = join(process.cwd(), 'tests/fixtures/codex-ws-fetch-preload.mjs')
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, HARNESS_PORT: String(port), HARNESS_PROFILE: 'fixture', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`, HARNESS_CODEX_FIXTURE_MODELS_MARKER: marker, HARNESS_CODEX_FIXTURE_RELEASE_FILE: release, HARNESS_CODEX_FIXTURE_MODELS_DONE: done, HARNESS_CODEX_FIXTURE_RACE_MODE: '1' }
    for (const key of ['HARNESS_DISABLE_CODEX_OAUTH', 'HARNESS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']) delete env[key]
    const child = spawn('pnpm', ['exec', 'tsx', 'src/server/index.ts'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk.toString() })
    child.stderr?.on('data', chunk => { output += chunk.toString() })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`startup timeout: ${output.slice(-1000)}`)), 15_000)
        const ready = () => { if (output.includes('Harness server on')) { clearTimeout(timer); resolve() } }
        child.stdout?.on('data', ready); child.stderr?.on('data', ready)
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output.slice(-1000)}`)) })
      })
      const socket = await open(`ws://127.0.0.1:${port}`)
      const messages: Wire[] = []
      socket.on('message', raw => { try { messages.push(JSON.parse(String(raw)) as Wire) } catch {} })
      socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: 'fixture-user', profile: 'fixture' }))
      await nextType(socket, 'session_ready')
      socket.send(JSON.stringify({ type: 'set_model', model: 'gpt-first', effort: 'low', request_id: 'first' }))
      await waitForFile(marker)
      socket.send(JSON.stringify({ type: 'set_model', model: 'gpt-second', effort: 'low', request_id: 'second' }))
      expect(await nextType(socket, 'model_changed')).toMatchObject({ model: 'gpt-second', request_id: 'second' })
      writeFileSync(release, 'release', 'utf8')
      await waitForFileContent(done, '1')
      expect(messages.filter(message => message.type === 'model_changed').map(message => message.model)).toEqual(['gpt-second'])
      socket.close()
    } finally {
      await stop(child)
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  it('drops an older catalog response after a profile switch', async () => {
    const home = mkdtempSync(join(tmpdir(), `harness-codex-profile-race-${randomUUID()}-`))
    const profiles = join(home, '.harness', 'profiles'); mkdirSync(profiles, { recursive: true })
    writeFileSync(join(home, 'prompt.md'), 'fixture prompt', 'utf8')
    for (const name of ['fixture', 'other']) writeFileSync(join(profiles, `${name}.yaml`), [
      `name: ${name}`, 'model:', '  auth: codex_oauth', '  id: gpt-5.4-mini',
      `system_prompt: ${join(home, 'prompt.md')}`, `artifact_dir: ${join(home, `${name}-artifacts`)}`, `working_dir: ${home}`,
    ].join('\n'), 'utf8')
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: Date.now() + 600_000, account_id: 'fixture-account' }, home)
    const marker = join(home, 'models-started')
    const release = join(home, 'release-models')
    const done = join(home, 'models-done')
    const port = 41000 + Math.floor(Math.random() * 1000)
    const preload = join(process.cwd(), 'tests/fixtures/codex-ws-fetch-preload.mjs')
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, HARNESS_PORT: String(port), HARNESS_PROFILE: 'fixture', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`, HARNESS_CODEX_FIXTURE_MODELS_MARKER: marker, HARNESS_CODEX_FIXTURE_RELEASE_FILE: release, HARNESS_CODEX_FIXTURE_MODELS_DONE: done }
    for (const key of ['HARNESS_DISABLE_CODEX_OAUTH', 'HARNESS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']) delete env[key]
    const child = spawn('pnpm', ['exec', 'tsx', 'src/server/index.ts'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk.toString() })
    child.stderr?.on('data', chunk => { output += chunk.toString() })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`startup timeout: ${output.slice(-1000)}`)), 15_000)
        const ready = () => { if (output.includes('Harness server on')) { clearTimeout(timer); resolve() } }
        child.stdout?.on('data', ready); child.stderr?.on('data', ready)
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output.slice(-1000)}`)) })
      })
      const socket = await open(`ws://127.0.0.1:${port}`)
      const messages: Wire[] = []
      socket.on('message', raw => { try { messages.push(JSON.parse(String(raw)) as Wire) } catch {} })
      socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: 'fixture-user', profile: 'fixture' }))
      await nextType(socket, 'session_ready')
      socket.send(JSON.stringify({ type: 'models_list' }))
      await waitForFile(marker)
      socket.send(JSON.stringify({ type: 'set_profile', profile: 'other' }))
      expect(await nextType(socket, 'session_ready')).toMatchObject({ profile: 'other' })
      writeFileSync(release, 'release', 'utf8')
      await waitForFile(done)
      expect(messages.filter(message => message.type === 'models')).toEqual([])
      socket.close()
    } finally {
      await stop(child)
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)
})
