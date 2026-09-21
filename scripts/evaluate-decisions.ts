import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createJevProvider } from '../src/decisions/jev.js'
import { DecisionLayerSchema, type DecisionRequest, type JsonValue } from '../src/decisions/types.js'

type EvaluationCase = {
  id: string
  request: string
  candidates: Array<{ id: string; description: string }>
  expected_applicable: string[]
  offline_applicable: Record<string, number>
  memory_candidate: { text: string; source_id: string; source_excerpt: string; source_role: string; scope: string; tainted: boolean }
  expected_memory_promotion: boolean
  offline_memory: { support: number; durable: number; useful: number }
}

type Corpus = { provenance: { name: string; description: string; created: string }; cases: EvaluationCase[] }

const corpus = JSON.parse(readFileSync(resolve(import.meta.dirname, '../tests/fixtures/decision-evaluation.json'), 'utf8')) as Corpus
const live = process.argv.includes('--live')
const json = process.argv.includes('--json')
const keyEnv = 'TYPESAFE_API_KEY'

function config() {
  return DecisionLayerSchema.parse({
    enabled: true,
    allow_remote_state: true,
    model: 'jev-1.13.0',
    api_key_env: keyEnv,
    endpoint: live ? 'https://api.typesafe.ai/v1/systemone' : 'http://127.0.0.1:9/v1/systemone',
    features: { capability_selection: 'shadow', memory_capture: 'shadow' },
    limits: { max_calls: corpus.cases.length, max_request_bytes: 64_000, max_response_bytes: 64_000, max_input_tokens: 12_000, max_output_tokens: 2_000, max_wall_ms: 30_000, max_cost_usd: 0.05 },
    price: { input_usd_per_million_tokens: 0.042, output_usd_per_million_tokens: 0 },
    retry: { max_attempts: 2, base_delay_ms: 50, max_delay_ms: 500 },
  })
}

function responseFor(testCase: EvaluationCase): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const candidate of testCase.candidates) {
    const probability = testCase.offline_applicable[candidate.id] ?? 0
    answers[`candidate:${candidate.id}`] = { type: 'noul', noul: probability }
  }
  answers.memory_support = { type: 'noul', noul: testCase.offline_memory.support }
  answers.memory_durable = { type: 'noul', noul: testCase.offline_memory.durable }
  answers.memory_useful = { type: 'noul', noul: testCase.offline_memory.useful }
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 120, output_tokens: 24 } }
}

function requestFor(testCase: EvaluationCase): DecisionRequest {
  const questions: DecisionRequest['questions'] = {}
  for (const candidate of testCase.candidates) {
    questions[`candidate:${candidate.id}`] = { type: 'noul', instructions: `Is capability ${candidate.id} (${candidate.description}) applicable to the synthetic user request?` }
  }
  questions.memory_support = { type: 'noul', instructions: 'Does the proposed memory fact have direct support in the supplied source excerpt from the stated source role?' }
  questions.memory_durable = { type: 'noul', instructions: 'Would the proposed memory fact remain useful beyond the current transient situation?' }
  questions.memory_useful = { type: 'noul', instructions: 'Would the proposed memory fact be useful in future tasks within its stated scope?' }
  return { model: 'jev-1.13.0', state: { case_id: testCase.id, request: testCase.request, candidates: testCase.candidates, memory_candidate: testCase.memory_candidate } as JsonValue, questions }
}

function aggregate(rows: Array<{ expected: Set<string>; selected: Set<string>; expectedMemory: boolean; promotedMemory: boolean }>) {
  let tp = 0; let fp = 0; let fn = 0; let memoryTp = 0; let memoryFp = 0; let memoryFn = 0
  for (const row of rows) {
    for (const label of row.selected) row.expected.has(label) ? tp++ : fp++
    for (const label of row.expected) if (!row.selected.has(label)) fn++
    if (row.promotedMemory && row.expectedMemory) memoryTp++
    if (row.promotedMemory && !row.expectedMemory) memoryFp++
    if (!row.promotedMemory && row.expectedMemory) memoryFn++
  }
  return {
    capability_precision: tp + fp ? tp / (tp + fp) : 1,
    capability_recall: tp + fn ? tp / (tp + fn) : 1,
    unsupported_memory_promotions: memoryFp,
    memory_promotion_precision: memoryTp + memoryFp ? memoryTp / (memoryTp + memoryFp) : 1,
    memory_promotion_recall: memoryTp + memoryFn ? memoryTp / (memoryTp + memoryFn) : 1,
  }
}

async function main() {
  if (live && !process.env[keyEnv]) throw new Error(`--live requires ${keyEnv} in the environment; the key value is never printed`)
  // Offline mode never leaves the process: the injected fetch answers every call, so a placeholder satisfies the provider's credential gate without reading a real key.
  if (!live && !process.env[keyEnv]) process.env[keyEnv] = 'offline-synthetic-placeholder'
  const telemetry: Array<{ input_tokens?: number; output_tokens?: number; cost_usd?: number; duration_ms: number }> = []
  const casesById = new Map(corpus.cases.map(testCase => [testCase.id, testCase]))
  const provider = createJevProvider(config(), {
    onTelemetry: record => telemetry.push({ input_tokens: record.input_tokens, output_tokens: record.output_tokens, cost_usd: record.cost_usd, duration_ms: record.duration_ms }),
    ...(live ? {} : { fetch: async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { state: { case_id: string } }
      const testCase = casesById.get(body.state.case_id)
      if (!testCase) return new Response('{}', { status: 422 })
      return new Response(JSON.stringify(responseFor(testCase)), { status: 200, headers: { 'content-type': 'application/json' } })
    } }),
  })
  const rows: Array<{ id: string; selected: string[]; promoted_memory: boolean; expected: string[]; expected_memory: boolean }> = []
  for (const testCase of corpus.cases) {
    const result = await provider.evaluate(requestFor(testCase), { cache_scope: { user: 'synthetic', profile: 'evaluation', project: corpus.provenance.name, run: testCase.id } })
    if (result.kind !== 'success') throw new Error(`case ${testCase.id} unavailable: ${result.reason ?? result.reason}`)
    const selected = testCase.candidates.map(candidate => candidate.id).filter(candidate => {
      const answer = result.response.answers[`candidate:${candidate}`]
      return answer?.type === 'noul' && answer.noul >= 0.5
    })
    const support = result.response.answers.memory_support
    const durable = result.response.answers.memory_durable
    const useful = result.response.answers.memory_useful
    const promoted = support?.type === 'noul' && durable?.type === 'noul' && useful?.type === 'noul' && support.noul >= 0.5 && durable.noul >= 0.5 && useful.noul >= 0.5
    rows.push({ id: testCase.id, selected, promoted_memory: promoted, expected: testCase.expected_applicable, expected_memory: testCase.expected_memory_promotion })
  }
  const metrics = aggregate(rows.map(row => ({ expected: new Set(row.expected), selected: new Set(row.selected), expectedMemory: row.expected_memory, promotedMemory: row.promoted_memory })))
  const result = {
    mode: live ? 'live' : 'offline',
    status: 'synthetic_fixture_only',
    production_accuracy: 'unknown',
    model: 'jev-1.13.0',
    provenance: corpus.provenance,
    case_ids: rows.map(row => row.id),
    metrics,
    observed: rows,
    requests: telemetry.length,
    input_tokens: telemetry.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
    output_tokens: telemetry.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
    cost_usd: telemetry.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0),
    latency_ms: telemetry.map(row => row.duration_ms),
  }
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(`Decision evaluation (${result.mode})\nCases: ${result.case_ids.length}\nCapability precision: ${metrics.capability_precision.toFixed(3)}\nCapability recall: ${metrics.capability_recall.toFixed(3)}\nUnsupported memory promotions: ${metrics.unsupported_memory_promotions}\nRequests: ${result.requests}; input tokens: ${result.input_tokens}; output tokens: ${result.output_tokens}; cost: $${result.cost_usd.toFixed(6)}\nProduction accuracy: unknown; this is synthetic fixture evidence only.`)
}

await main()
