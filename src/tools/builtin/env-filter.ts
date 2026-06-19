// Strips sensitive env vars from process.env before passing to subprocesses.
// Keeps all vars by default; strips keys matching these patterns (case-insensitive):
// *_API_KEY, *_TOKEN, *_SECRET, HARNESS_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
// Profile can declare `exec_env_passthrough: ['MY_VAR']` to re-allow specific keys.

export function sanitizeEnv(extra_deny: string[] = []): NodeJS.ProcessEnv {
  const DENY_PATTERNS = [
    /API_KEY$/i,
    /SECRET$/i,
    /_TOKEN$/i,
    /^HARNESS_API_KEY$/i,
  ]
  const result: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (DENY_PATTERNS.some(p => p.test(k))) continue
    if (extra_deny.includes(k)) continue
    result[k] = v
  }
  return result
}
