import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve('src/types.ts'), 'utf8').replace(/^import .*\n/gm, '')
const shared = `export interface Project { id: string; user: string; name: string; created_at: string; description?: string }
export interface SessionSummary { id: string; project: string; title?: string; summary?: string; created_at: string; usage: { input: number; output: number; cost_usd: number } }
export interface PendingInput { id: string; run_id: string; session_id: string; user: string; profile: string; prompt: string; kind: 'text' | 'select' | 'multi_select'; options?: string[]; created_at: string; expires_at: string; state: string }
export type Stage = 'recon' | 'plan' | 'design' | 'build' | 'verify' | 'review'
export type Intensity = 0 | 1 | 2 | 3
export type Tier = 'cheap' | 'balanced' | 'frontier' | 'critic'
export type Reversibility = 'easy' | 'hard' | 'irreversible'
`
const output = `// Generated from src/types.ts by scripts/gen-web-protocol.mjs. Do not edit.\n\n${shared}\n${source}`
const target = resolve('web/lib/protocol.ts')

if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== output) process.exit(1)
} else {
  writeFileSync(target, output)
}
