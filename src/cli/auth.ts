import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { loginWithBrowser } from '../provider/auth/oauth.js'
import { loginWithDevice } from '../provider/auth/device.js'
import { codexAuthStatus, logoutCodex } from '../provider/auth/store.js'
import { sanitizeError, redactSecret } from '../provider/auth/redact.js'

export interface AuthIO { write(message: string): void; error?(message: string): void }
export interface AuthCommandOptions { homeDir?: string; io?: AuthIO; browserOpen?: (url: string) => Promise<void>; browserLogin?: typeof loginWithBrowser; deviceLogin?: typeof loginWithDevice }
export const AUTH_EXIT = { ok: 0, failure: 1, invalidArgs: 2, loginRequired: 3, interrupted: 130 } as const

export async function runAuthCommand(args: string[], options: AuthCommandOptions = {}): Promise<number> {
  const io: AuthIO = options.io ?? { write: message => console.log(message), error: message => console.error(message) }; const home = options.homeDir ?? homedir()
  try {
    if (args[0] !== 'login' && args[0] !== 'status' && args[0] !== 'logout') return fail(io, 'usage: harness auth login|status|logout openai [--method browser|device]', AUTH_EXIT.invalidArgs)
    const provider = args[1]
    if (provider !== 'openai') return fail(io, 'only OpenAI Codex auth is supported', AUTH_EXIT.invalidArgs)
    if (args[0] === 'status') {
      const json = args.includes('--json'); if (!(args.length === 2 || (args.length === 3 && args[2] === '--json'))) return fail(io, 'usage: harness auth status openai [--json]', AUTH_EXIT.invalidArgs)
      const status = codexAuthStatus(home); if (json) io.write(JSON.stringify({ provider: 'openai', transport: 'codex_oauth', ...status })); else io.write(`openai Codex OAuth: ${status.status}${status.accountHint ? ` (${status.accountHint})` : ''}${status.expiresAt ? `; expires ${new Date(status.expiresAt).toISOString()}` : ''}`)
      return status.status === 'active' ? AUTH_EXIT.ok : status.status === 'disabled' ? AUTH_EXIT.loginRequired : status.status === 'missing' || status.status === 'expired' || status.status === 'reauth_required' ? AUTH_EXIT.loginRequired : AUTH_EXIT.failure
    }
    if (args[0] === 'logout') {
      if (args.length !== 2) return fail(io, 'usage: harness auth logout openai', AUTH_EXIT.invalidArgs)
      await logoutCodex(home); io.write('Logged out of Codex OAuth. API keys unchanged.'); return AUTH_EXIT.ok
    }
    if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1') return fail(io, 'Codex OAuth is disabled; configure an API profile', AUTH_EXIT.loginRequired)
    const methodIndex = args.indexOf('--method'); const method = methodIndex === -1 ? 'browser' : args[methodIndex + 1]
    if (method !== 'browser' && method !== 'device') return fail(io, 'login method must be browser or device', AUTH_EXIT.invalidArgs)
    if (!(args.length === 2 || (args.length === 4 && methodIndex === 2))) return fail(io, 'usage: harness auth login openai --method browser|device', AUTH_EXIT.invalidArgs)
    const browser = options.browserLogin ?? loginWithBrowser; const device = options.deviceLogin ?? loginWithDevice
    const controller = new AbortController()
    const onInterrupt = () => controller.abort()
    process.once('SIGINT', onInterrupt)
    try {
      const openBrowser = options.browserOpen ?? (async (url: string) => { try { await defaultBrowserOpen(url) } catch { io.write(`Open this URL manually to continue login: ${url}`) } })
      const credential = method === 'browser' ? await browser({ home, signal: controller.signal, openBrowser }) : await device({ home, signal: controller.signal, write: message => io.write(message) })
      io.write(`Codex OAuth login complete (${redactSecret(credential.account_id)}).`); return AUTH_EXIT.ok
    } finally { process.removeListener('SIGINT', onInterrupt) }
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return fail(io, 'authentication interrupted', AUTH_EXIT.interrupted)
    return fail(io, sanitizeError(error), AUTH_EXIT.failure)
  }
}

async function defaultBrowserOpen(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
  await new Promise<void>((resolve, reject) => { const child = spawn(command, [url], { stdio: 'ignore', shell: false }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`could not launch browser (${command})`))) })
}
function fail(io: AuthIO, message: string, code: number): number { (io.error ?? io.write)(message); return code }
