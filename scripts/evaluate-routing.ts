import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createJevProvider } from '../src/decisions/jev.js'
import { createWorkflowDecisionAdvisor, WorkflowDecisionControlError } from '../src/decisions/workflow.js'
import { decideRoute, type RouteSignals, type RouterConfig, type Scale, type SessionRoute } from '../src/workflow/route.js'
import { DecisionLayerSchema } from '../src/decisions/types.js'

/**
 * Offline/live evaluation for the request routing graph (roadmap #31 phase
 * 2, PT-077, spec §6/§7). Sibling of `scripts/evaluate-decisions.ts` — kept
 * separate because the routing corpus schema (playbooks/scale/ambiguity/
 * multi-domain/follow-up) is not the capability/memory shape that script
 * scores. Offline mode never requires a credential or leaves the process:
 * it runs the pure `decideRoute` policy directly against each case's
 * `offline_signals` and reports accuracy against the labeled `expected`.
 * `--live` calls the real Jev fan-out (`chooseRoute`) via `createJevProvider`,
 * exactly like the existing script's live path.
 */

type RoutingCase = {
  id: string
  request: string
  session_route?: SessionRoute
  expected: { kind: 'ask' | 'run'; playbooks: string[]; scale: Scale | null }
  offline_signals: RouteSignals
}

type Corpus = { provenance: { name: string; description: string; created: string }; cases: RoutingCase[] }

const corpus = JSON.parse(readFileSync(resolve(import.meta.dirname, '../tests/fixtures/routing-evaluation.json'), 'utf8')) as Corpus
const live = process.argv.includes('--live')
const json = process.argv.includes('--json')
// --signals-out <path>: write every row with its raw Jev signals, for offline threshold sweeps.
const signalsOutIndex = process.argv.indexOf('--signals-out')
const signalsOut = signalsOutIndex >= 0 ? process.argv[signalsOutIndex + 1] : undefined
const keyEnv = 'TYPESAFE_API_KEY'
const PLAYBOOKS = [
  { name: 'coding', description: 'Software change workflow' },
  { name: 'data', description: 'Reproducible data workflow' },
  { name: 'generic', description: 'Safe generic workflow' },
  { name: 'research', description: 'Evidence-first research workflow' },
  { name: 'security', description: 'Reproducible security review workflow' },
  { name: 'writing', description: 'Structured writing workflow' },
]

const routerConfig: RouterConfig = { domain_threshold: 0.5, ask_threshold: 0.7, max_reroutes: 1, max_clarifications: 1 }

type Row = { id: string; kind: 'ask' | 'run'; playbooks: string[]; scale: Scale | null; expected_kind: 'ask' | 'run'; expected_playbooks: string[]; expected_scale: Scale | null; match: boolean; fallback?: string; signals?: RouteSignals }

function decisionRow(testCase: RoutingCase, signals: RouteSignals | undefined, fallback?: string): Row {
  if (!signals) {
    return { id: testCase.id, kind: 'ask', playbooks: [], scale: null, expected_kind: testCase.expected.kind, expected_playbooks: testCase.expected.playbooks, expected_scale: testCase.expected.scale, match: false, fallback: fallback ?? 'no signals' }
  }
  const decision = decideRoute(signals, routerConfig, 'generic', routerConfig.max_clarifications, testCase.session_route)
  const playbooks = decision.kind === 'run' ? decision.playbooks : []
  const scale = decision.kind === 'run' ? decision.scale : null
  const match = decision.kind === testCase.expected.kind &&
    JSON.stringify(playbooks) === JSON.stringify(testCase.expected.playbooks) &&
    scale === testCase.expected.scale
  return { id: testCase.id, kind: decision.kind, playbooks, scale, expected_kind: testCase.expected.kind, expected_playbooks: testCase.expected.playbooks, expected_scale: testCase.expected.scale, match, fallback, signals }
}

async function runOffline(): Promise<Row[]> {
  return corpus.cases.map(testCase => decisionRow(testCase, testCase.offline_signals))
}

async function runLive(): Promise<Row[]> {
  if (!process.env[keyEnv]) throw new Error(`--live requires ${keyEnv} in the environment; the key value is never printed`)
  const config = DecisionLayerSchema.parse({
    enabled: true,
    allow_remote_state: true,
    model: 'jev-1.13.0',
    api_key_env: keyEnv,
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    features: { request_routing: 'shadow' },
    limits: { max_calls: corpus.cases.length, max_request_bytes: 64_000, max_response_bytes: 64_000, max_input_tokens: 12_000, max_output_tokens: 2_000, max_wall_ms: 30_000, max_cost_usd: 0.25 },
    price: { input_usd_per_million_tokens: 0.042, output_usd_per_million_tokens: 0 },
    retry: { max_attempts: 2, base_delay_ms: 50, max_delay_ms: 500 },
  })
  const provider = createJevProvider(config)
  const advisor = createWorkflowDecisionAdvisor({ provider, model: config.model! })
  const rows: Row[] = []
  for (const testCase of corpus.cases) {
    try {
      const signals = await advisor.chooseRoute!(testCase.request, PLAYBOOKS, testCase.session_route)
      rows.push(decisionRow(testCase, signals))
    } catch (error) {
      if (error instanceof WorkflowDecisionControlError) throw error
      rows.push(decisionRow(testCase, undefined, error instanceof Error ? error.message : 'unknown error'))
    }
  }
  return rows
}

async function main() {
  const rows = live ? await runLive() : await runOffline()
  const matches = rows.filter(row => row.match).length
  const accuracy = rows.length ? matches / rows.length : 1
  const SCALE_ORDER: Array<Scale | null> = ['trivial', 'small', 'medium', 'large']
  const rate = (predicate: (row: Row) => boolean, subset = rows) => subset.length ? subset.filter(predicate).length / subset.length : 1
  const kindOk = (row: Row) => row.kind === row.expected_kind
  const bothRun = rows.filter(row => row.kind === 'run' && row.expected_kind === 'run')
  // Per-dimension accuracy: kind over all rows; playbooks and scale only where both sides ran.
  const per_dimension = {
    kind: rate(kindOk),
    playbooks: rate(row => JSON.stringify(row.playbooks) === JSON.stringify(row.expected_playbooks), bothRun),
    primary_playbook: rate(row => row.playbooks[0] === row.expected_playbooks[0], bothRun),
    scale_exact: rate(row => row.scale === row.expected_scale, bothRun),
    scale_within_one: rate(row => Math.abs(SCALE_ORDER.indexOf(row.scale) - SCALE_ORDER.indexOf(row.expected_scale)) <= 1, bothRun),
  }
  if (signalsOut) writeFileSync(signalsOut, JSON.stringify(rows, null, 2))
  const result = {
    mode: live ? 'live' : 'offline',
    status: 'synthetic_fixture_only',
    production_accuracy: live ? 'observed_against_synthetic_labels' : 'unknown',
    provenance: corpus.provenance,
    cases: rows.length,
    matches,
    accuracy,
    per_dimension,
    mismatches: rows.filter(row => !row.match).map(({ signals: _signals, ...row }) => row),
  }
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(`Routing evaluation (${result.mode})\nCases: ${result.cases}\nMatches: ${result.matches}\nAccuracy: ${(accuracy * 100).toFixed(1)}%\nPer dimension: ${Object.entries(per_dimension).map(([key, value]) => `${key} ${(value * 100).toFixed(0)}%`).join(', ')}\n${result.mismatches.length > 0 ? `Mismatches:\n${result.mismatches.map(row => `  ${row.id}: got ${row.kind}/${JSON.stringify(row.playbooks)}/${row.scale}${row.fallback ? ` (fallback: ${row.fallback})` : ''} expected ${row.expected_kind}/${JSON.stringify(row.expected_playbooks)}/${row.expected_scale}`).join('\n')}` : 'All cases matched.'}\nProduction accuracy: ${result.production_accuracy}; this is synthetic fixture evidence only.`)
}

await main()
