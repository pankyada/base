import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const API = 'http://127.0.0.1:7444'

async function waitForHealth(child: ChildProcess): Promise<void> {
  let lastError = 'server did not start'
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`fixture harness exited before health: ${lastError}`)
    try {
      const response = await fetch(`${API}/health`)
      if (response.ok) return
      lastError = `health returned ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  }
  throw new Error(`fixture harness health timeout: ${lastError}`)
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const repo = existsSync(join(process.cwd(), 'src', 'server', 'index.ts')) ? process.cwd() : resolve(process.cwd(), '..')
  const user = `runtime-browser-${process.pid}`
  const source = join(repo, `.r10-runtime-e2e-${process.pid}.json`)
  const artifacts = join(homedir(), '.harness', 'artifacts', user)
  const child = spawn('pnpm', ['dev:server'], {
    cwd: repo,
    env: {
      ...process.env,
      HARNESS_PORT: '7444',
      HARNESS_PROFILE: 'coding',
      HARNESS_ALLOWED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', chunk => { output += String(chunk).slice(-4000) })
  child.stderr?.on('data', chunk => { output += String(chunk).slice(-4000) })
  try {
    await waitForHealth(child)
    writeFileSync(source, JSON.stringify({ value: 6 }), 'utf8')
    const response = await fetch(`${API}/artifacts?user=${encodeURIComponent(user)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profile: 'coding',
        generating_tool: 'artifact-refresh',
        parameters: { multiplier: 3 },
        payload: { value: 0 },
        source_dependencies: [`file:${source}`],
        session_id: 'session-runtime-browser',
        tool_call_id: 'tool-runtime-browser',
      }),
    })
    if (!response.ok) throw new Error(`fixture recipe creation failed (${response.status}): ${await response.text()}`)
    process.env.R10_E2E_USER = user
    process.env.R10_E2E_SOURCE = source
    process.env.NEXT_PUBLIC_HARNESS_HTTP_URL = API
  } catch (error) {
    child.kill('SIGTERM')
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`)
  }

  return async () => {
    if (child.pid) child.kill('SIGTERM')
    else child.kill()
    await new Promise(resolveExit => {
      if (child.exitCode !== null) return resolveExit(undefined)
      child.once('exit', () => resolveExit(undefined))
      setTimeout(() => resolveExit(undefined), 5_000)
    })
    try { rmSync(source, { force: true }) } catch {}
    try { if (existsSync(artifacts)) rmSync(artifacts, { recursive: true, force: true }) } catch {}
  }
}
