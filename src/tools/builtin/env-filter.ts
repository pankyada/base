// Strips sensitive env vars from process.env before passing to subprocesses.
// Keeps all vars by default; strips keys matching these patterns (case-insensitive):
// *_API_KEY, *_TOKEN (including GITHUB_TOKEN, NPM_TOKEN, etc.), *_SECRET
// Note: *_TOKEN strips ALL tokens, not just app-specific ones — know this trade-off when allowing env through.

export function sanitizeEnv(): NodeJS.ProcessEnv {
  const DENY_PATTERNS = [
    /API_KEY$/i,
    /SECRET$/i,
    /_TOKEN$/i,
  ]
  const result: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (DENY_PATTERNS.some(p => p.test(k))) continue
    result[k] = v
  }
  return result
}
