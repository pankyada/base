import { exec } from 'child_process'
import { promisify } from 'util'
import { Profile } from '../profiles/schema.js'

const execAsync = promisify(exec)

export type HookType = 'pre_tool' | 'post_tool' | 'on_stop'

export async function runHooks(
  hookType: HookType,
  profile: Profile,
  env: Record<string, string> = {}
): Promise<void> {
  const hooks = profile.hooks?.[hookType] ?? []
  const timeout_ms = profile.hooks?.timeout_ms ?? 5000
  for (const cmd of hooks) {
    try {
      await execAsync(cmd, {
        env: { ...(process.env as Record<string, string>), ...env },
        timeout: timeout_ms,
      })
    } catch (e: any) {
      if (e.killed) {
        console.error(`[hook:${hookType}] timed out after ${timeout_ms}ms: ${cmd}`)
      } else {
        console.error(`[hook:${hookType}] failed: ${cmd}\n${e.stderr?.toString() ?? e.message}`)
      }
    }
  }
}
