import { execSync } from 'child_process'
import { Profile } from '../profiles/schema.js'

export type HookType = 'pre_tool' | 'post_tool' | 'on_stop'

export function runHooks(
  hookType: HookType,
  profile: Profile,
  env: Record<string, string> = {}
): void {
  const hooks = profile.hooks?.[hookType] ?? []
  for (const cmd of hooks) {
    try {
      execSync(cmd, {
        env: { ...process.env as Record<string, string>, ...env },
        stdio: 'pipe',
      })
    } catch (e: any) {
      console.error(`[hook:${hookType}] failed: ${cmd}\n${e.stderr?.toString() ?? e.message}`)
    }
  }
}
