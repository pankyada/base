import { createServer } from 'net'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { loadUserEnv } from '../config/user-env.js'
import { readUserConfig } from '../config/user-config.js'
import { loadStartupProfiles } from '../server/profile-startup.js'
import { listServers } from '../server/process-registry.js'
import { createProviderClient } from '../provider/client.js'
import { createProvider } from '../provider/factory.js'
import { codexAuthStatus } from '../provider/auth/store.js'
import { sanitizeError } from '../provider/auth/redact.js'
import pkg from '../../package.json' with { type: 'json' }

export interface DoctorCheck { name: string; ok: boolean; detail: string; fix: string }
export interface DoctorResult { ok: boolean; checks: DoctorCheck[] }
export interface DoctorOptions {
  homeDir?: string
  environment?: NodeJS.ProcessEnv
  offline?: boolean
  portCheck?: (port: number) => Promise<boolean>
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const homeDir = options.homeDir ?? homedir()
  const environment = options.environment ?? process.env
  loadUserEnv(homeDir, environment)
  const checks: DoctorCheck[] = []
  const config = readUserConfig(homeDir)
  checks.push(config
    ? pass('config', 'config.json is valid')
    : fail('config', 'config.json is missing or invalid', 'harness init'))

  let profile: ReturnType<typeof loadStartupProfiles>['defaultProfile'] | undefined
  try {
    profile = loadStartupProfiles({ homeDir, environment }).defaultProfile
    checks.push(pass('profile', `default profile: ${profile.name}`))
  } catch (error: any) {
    checks.push(fail('profile', error.message, 'harness init --reconfigure'))
  }

  let credentialReady = false
  if (profile?.model.auth === 'codex_oauth') {
    try {
      const status = codexAuthStatus(homeDir)
      credentialReady = status.status === 'active' || status.status === 'expired'
      checks.push(credentialReady
        ? pass('codex_auth', `Codex subscription: ${status.status}; ${status.accountHint ?? 'account linked'}`)
        : fail('codex_auth', `Codex subscription: ${status.status}`, 'harness auth login openai --method browser'))
    } catch (error) { checks.push(fail('codex_auth', sanitizeError(error), 'inspect the Codex credential store')) }
  } else if (profile) {
    const key = environment[profile.model.api_key_env]
    credentialReady = Boolean(key)
    checks.push(key
      ? pass('api_key', `${profile.model.api_key_env} is set`)
      : fail('api_key', `${profile.model.api_key_env} is not set`, 'harness init --reconfigure'))
  } else {
    checks.push(fail('api_key', 'active profile is unavailable', 'harness init --reconfigure'))
  }

  if (options.offline) {
    checks.push(pass('reachability', 'skipped (--offline)'))
  } else if (!profile || !credentialReady) {
    checks.push(fail('reachability', 'not attempted without configured provider credentials', 'harness init --reconfigure'))
  } else {
    try {
      if (profile.model.auth === 'codex_oauth') {
        await createProvider(profile, { home: homeDir }).generate({
          model: profile.model.id, messages: [{ role: 'user', content: 'Reply with pong.' }], maxCompletionTokens: 5,
        }, { purpose: 'doctor', deadline: Date.now() + 15_000 })
      } else {
        const client = createProviderClient(profile, environment)
        await client.chat.completions.create({ model: profile.model.id, messages: [{ role: 'user', content: 'ping' }], max_completion_tokens: 5 })
      }
      checks.push(pass('reachability', `${profile.model.id} accepted a smoke request`))
    } catch (error: any) {
      checks.push(fail('reachability', sanitizeError(error), profile.model.auth === 'codex_oauth' ? 'harness auth status openai' : 'check the provider base URL and API key'))
    }
  }

  const port = Number.parseInt(environment.HARNESS_PORT ?? '7337', 10)
  const registered = listServers(environment.HARNESS_SERVER_REGISTRY_DIR ?? join(homeDir, '.harness', 'servers')).some(server => server.port === port && server.status === 'running')
  const free = registered || await (options.portCheck ?? isPortFree)(port)
  checks.push(free
    ? pass('port', registered ? `port ${port} is owned by harness` : `port ${port} is free`)
    : fail('port', `port ${port} is already in use`, 'harness server list'))

  checks.push(pass('binaries', `harness ${pkg.version} is running`))
  const expectedBin = join(homeDir, '.local', 'bin')
  const pathEntries = (environment.PATH ?? '').split(delimiter)
  checks.push(pathEntries.includes(expectedBin)
    ? pass('path', `${expectedBin} is available`)
    : fail('path', `${expectedBin} is not on PATH`, `export PATH="${expectedBin}:$PATH"`))

  return { ok: checks.every(check => check.ok), checks }
}

export async function runDoctorCommand(args: string[], output: { log(message: string): void; error(message: string): void } = console, options: DoctorOptions = {}): Promise<number> {
  const result = await runDoctor({ ...options, offline: args.includes('--offline') || options.offline })
  if (args.includes('--json')) output.log(JSON.stringify(result))
  else for (const check of result.checks) output.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}${check.ok ? '' : `\n  fix: ${check.fix}`}`)
  return result.ok ? 0 : 1
}

function pass(name: string, detail: string): DoctorCheck { return { name, ok: true, detail, fix: '' } }
function fail(name: string, detail: string, fix: string): DoctorCheck { return { name, ok: false, detail, fix } }

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}
