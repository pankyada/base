import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { FullConfig } from '@playwright/test'

const providerPort = 18831
const harnessPort = 18832

function waitHttp(url: string, child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const tick = () => {
      if (child.exitCode !== null) return reject(new Error(`${label} exited ${child.exitCode}`))
      const request = fetch(url).then(response => { if (response.ok) resolve(); else retry() }).catch(retry)
      void request
    }
    const retry = () => { if (Date.now() >= deadline) reject(new Error(`${label} startup timeout`)); else setTimeout(tick, 150) }
    tick()
  })
}

function waitMessage(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture WS timeout waiting ${type}`)), 15_000)
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString())
      if (message.type === type) { clearTimeout(timer); ws.off('message', onMessage); resolve(message) }
    }
    ws.on('message', onMessage)
  })
}

async function seedTurn(user: string, profile: string, marker: string): Promise<{ sessionId: string }> {
  const ws = new WebSocket(`ws://127.0.0.1:${harnessPort}`)
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
  ws.send(JSON.stringify({ type: 'hello', protocol_version: 4, wasm_supported: true, user_id: user, profile }))
  const ready = await waitMessage(ws, 'session_ready')
  ws.send(JSON.stringify({ type: 'message', content: marker }))
  await waitMessage(ws, 'session_end')
  ws.close()
  return { sessionId: ready.sessionId }
}

export default async function globalSetup(_config: FullConfig) {
  if (await fetch(`http://127.0.0.1:${providerPort}/models`).then(r => r.ok).catch(() => false)) throw new Error(`client acceptance provider port ${providerPort} occupied`)
  if (await fetch(`http://127.0.0.1:${harnessPort}/health`).then(r => r.ok).catch(() => false)) throw new Error(`client acceptance harness port ${harnessPort} occupied`)
  const root = await mkdtemp(join(tmpdir(), 'harness-client-acceptance-'))
  const profilesDir = join(root, '.harness', 'profiles')
  await mkdir(profilesDir, { recursive: true })
  await writeFile(join(root, 'prompt.md'), 'client acceptance fixture prompt\n')
  const yaml = (name: string, artifact: string) => [
    `name: ${name}`, 'model:', `  base_url: http://127.0.0.1:${providerPort}/v1`, '  api_key_env: TEST_KEY', '  id: fixture-model',
    `system_prompt: ${join(root, 'prompt.md')}`, `artifact_dir: ${artifact}`, `working_dir: ${root}`, 'approval_mode: danger', 'safety:', '  enabled: false', 'improvement:', '  enabled: false', 'tools:', '  builtin:', '    Bash: allow', '    AskUser: allow', '',
  ].join('\n')
  const artifactP = join(root, 'artifacts', 'fixture-p')
  const artifactQ = join(root, 'artifacts', 'fixture-q')
  await mkdir(join(root, 'artifacts'), { recursive: true })
  await writeFile(join(profilesDir, 'fixture-p.yaml'), yaml('fixture-p', artifactP))
  await writeFile(join(profilesDir, 'fixture-q.yaml'), yaml('fixture-q', artifactQ))
  const artifactMap = join(root, 'artifacts', 'fixture-map')
  await writeFile(join(profilesDir, 'fixture-map.yaml'), yaml('fixture-map', artifactMap).replace('tools:\n', [
    'workflow:', '  enabled: true', '  playbook: generic', '  routing:', '    policy: static', '    explore_rate: 0', '    shadow_rate: 0', 'tools:',
  ].join('\n') + '\n'))
  const provider = spawn(process.execPath, [join(process.cwd(), '..', 'scripts', 'client-acceptance-provider.mjs')], { cwd: join(process.cwd(), '..'), env: { ...process.env, CLIENT_ACCEPTANCE_PROVIDER_PORT: String(providerPort) }, stdio: ['ignore', 'pipe', 'pipe'] })
  const harness = spawn(process.execPath, ['--import', 'tsx', '--import', './scripts/client-acceptance-sockets.mjs', 'src/server/index.ts', '--profiles', profilesDir, '--default-profile', 'fixture-p'], { cwd: join(process.cwd(), '..'), env: { ...process.env, HOME: root, CLIENT_ACCEPTANCE_SOCKET_COUNT: join(root, 'socket-count.json'), HARNESS_PORT: String(harnessPort), HARNESS_ALLOWED_ORIGINS: 'http://127.0.0.1:3012', TEST_KEY: 'fixture-key', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  provider.stdout?.on('data', chunk => { logs += chunk.toString() })
  harness.stdout?.on('data', chunk => { logs += chunk.toString() })
  harness.stderr?.on('data', chunk => { logs += chunk.toString() })
  try {
    await waitHttp(`http://127.0.0.1:${providerPort}/models`, provider, 'fake provider')
    await waitHttp(`http://127.0.0.1:${harnessPort}/health`, harness, 'harness')
    const a = await seedTurn('ca-user-a', 'fixture-p', 'CA_SCOPE_A transcript marker')
    const b = await seedTurn('ca-user-b', 'fixture-q', 'CA_SCOPE_B transcript marker')
    await seedTurn('ca-user-a', 'fixture-p', 'CA_AUDIT_A create audit marker')
    await seedTurn('ca-user-b', 'fixture-q', 'CA_AUDIT_B create audit marker')
    // Seed private memory through the same filesystem contract used by FsMemoryProvider.
    for (const [artifact, user, marker] of [[artifactP, 'ca-user-a', 'CA_MEMORY_A'], [artifactQ, 'ca-user-b', 'CA_MEMORY_B']] as const) {
      const dir = join(artifact, 'users', user, 'memory'); await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'acceptance.md'), `${marker} private memory\n`)
      await writeFile(join(dir, 'MEMORY.md'), `# Memory Index\n\n- **acceptance**: ${marker} private memory\n`)
    }
    const fixture = { root, socketCount: join(root, 'socket-count.json'), users: { a: 'ca-user-a', b: 'ca-user-b' }, profiles: { a: 'fixture-p', b: 'fixture-q' }, sessions: { a: a.sessionId, b: b.sessionId } }
    const fixturePath = join(root, 'fixture.json')
    await writeFile(fixturePath, JSON.stringify(fixture))
    process.env.CLIENT_ACCEPTANCE_FIXTURE = fixturePath
    process.env.CLIENT_ACCEPTANCE_LOG = logs
  } catch (error) {
    provider.kill('SIGTERM'); harness.kill('SIGTERM')
    await rm(root, { recursive: true, force: true })
    throw new Error(`${(error as Error).message}; logs=${logs.slice(-4000)}`)
  }
  return async () => {
    const stop = (child: ChildProcess) => new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve() }, 3000)
    })
    await Promise.all([stop(provider), stop(harness)])
    await rm(root, { recursive: true, force: true })
  }
}
