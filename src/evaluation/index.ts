import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { atomicWriteJson, readJson } from '../shared/atomic-json.js'
import { userPaths } from '../session/user-paths.js'
import type { Mission, Receipt } from '../missions/index.js'

export type EvaluationSplit = 'development' | 'held_out'
export interface EvaluationCase { id: string; input: string; fixture_refs: string[]; expected: Record<string, unknown>; split: EvaluationSplit; source_mission_id?: string }
export interface EvaluationDataset { version: 1; id: string; name: string; cases: EvaluationCase[]; created_at: string; revision: number }
export interface CaseResult { case_id: string; correct: boolean | null; cost_usd?: number; latency_ms?: number; tool_errors: number; human_intervention: boolean; actual?: Record<string, unknown>; error?: string }
export type EvaluationStatus = 'running' | 'completed' | 'cancelled' | 'budget_exceeded' | 'incomplete'
export interface EvaluationRun { version: 1; id: string; dataset_id: string; profile: string; config_fingerprint: string; seed: number; status: EvaluationStatus; results: CaseResult[]; started_at: string; finished_at?: string; budget_usd?: number }
export interface EvaluationSummary { run_id: string; sample_count: number; completed_count: number; correct_count: number; accuracy: number | null; cost_usd: number; mean_latency_ms: number | null; tool_errors: number; human_intervention: number; unavailable: string[]; status?: EvaluationStatus }
export interface PromotionGate { pass: boolean; reason: string[] }
export interface EvaluationExperiment { version: 1; id: string; dataset_id: string; baseline_run_id?: string; candidate_run_id?: string; created_at: string; comparison?: Record<string, number | null> }
export interface CaptureCaseInput { mission: Mission; receipt: Receipt; input: string; split?: EvaluationSplit; fixture_refs?: string[]; expected?: Record<string, unknown> }
export interface FixtureEvaluationOptions { fixtureRoot?: string; signal?: AbortSignal }

export function createDataset(name: string, cases: Array<Omit<EvaluationCase, 'id'> & { id?: string }>): EvaluationDataset {
  const ids = new Set<string>(); const normalized = cases.map(item => { const id = item.id ?? randomUUID(); if (ids.has(id)) throw new Error(`duplicate evaluation case id '${id}'`); ids.add(id); return { ...item, id } }); validateDataset({ version: 1, id: 'pending', name, cases: normalized, created_at: new Date().toISOString(), revision: 1 }); return { version: 1, id: randomUUID(), name, cases: normalized, created_at: new Date().toISOString(), revision: 1 }
}
export function captureCaseFromMission(input: CaptureCaseInput): Omit<EvaluationCase, 'id'> {
  if (input.receipt.mission_id !== input.mission.id || input.receipt.user !== input.mission.user) throw new Error('mission receipt does not match mission')
  const expected = input.expected ?? { accepted: input.receipt.accepted, execution: input.receipt.execution }
  return { input: input.input, fixture_refs: input.fixture_refs ?? [], expected, split: input.split ?? 'development', source_mission_id: input.mission.id }
}
export function validateDataset(dataset: EvaluationDataset): void {
  if (dataset.version !== 1 || !dataset.id || !Array.isArray(dataset.cases)) throw new Error('invalid evaluation dataset')
  const ids = new Set<string>(); for (const item of dataset.cases) { if (ids.has(item.id)) throw new Error(`duplicate evaluation case id '${item.id}'`); ids.add(item.id); if (!item.input || !['development', 'held_out'].includes(item.split)) throw new Error(`invalid evaluation case '${item.id}'`) }
}
/** Deterministic assertion: expected fields must equal actual fields; no model judge involved. */
export function deterministicAssertion(expected: Record<string, unknown>, actual: Record<string, unknown> | undefined): boolean | null {
  if (!actual) return null
  return Object.entries(expected).every(([key, value]) => stableJson(actual[key]) === stableJson(value))
}
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'; if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}` }
function deterministicOrder(cases: EvaluationCase[], seed: number): EvaluationCase[] { return [...cases].sort((a, b) => { const hash = (value: string) => { let n = seed >>> 0; for (const ch of value) n = Math.imul(n ^ ch.charCodeAt(0), 16777619); return n >>> 0 }; return hash(a.id) - hash(b.id) || a.id.localeCompare(b.id) }) }
export function summarize(run: EvaluationRun, splitCases?: EvaluationCase[]): EvaluationSummary {
  const allowed = splitCases ? new Set(splitCases.map(c => c.id)) : undefined; const results = run.results.filter(r => !allowed || allowed.has(r.case_id)); const complete = results.filter(r => r.correct !== null); const correct = complete.filter(r => r.correct === true).length; const timed = results.filter(r => r.latency_ms !== undefined)
  return { run_id: run.id, sample_count: results.length, completed_count: complete.length, correct_count: correct, accuracy: complete.length ? correct / complete.length : null, cost_usd: results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0), mean_latency_ms: timed.length ? timed.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0) / timed.length : null, tool_errors: results.reduce((sum, r) => sum + r.tool_errors, 0), human_intervention: results.filter(r => r.human_intervention).length, unavailable: results.filter(r => r.correct === null).map(r => r.case_id), status: run.status }
}
export function compare(baseline: EvaluationSummary, candidate: EvaluationSummary): Record<string, number | null> { return { accuracy_delta: baseline.accuracy === null || candidate.accuracy === null ? null : candidate.accuracy - baseline.accuracy, cost_delta: candidate.cost_usd - baseline.cost_usd, latency_delta: baseline.mean_latency_ms === null || candidate.mean_latency_ms === null ? null : candidate.mean_latency_ms - baseline.mean_latency_ms, tool_error_delta: candidate.tool_errors - baseline.tool_errors, human_intervention_delta: candidate.human_intervention - baseline.human_intervention, unavailable_delta: candidate.unavailable.length - baseline.unavailable.length } }
export function promotionGate(dev: EvaluationSummary, heldOut: EvaluationSummary, options: { minSamples: number; maxRegression: number }): PromotionGate {
  const reason: string[] = []; if (dev.status && dev.status !== 'completed') reason.push(`development evaluation is ${dev.status}`); if (heldOut.status && heldOut.status !== 'completed') reason.push(`held-out evaluation is ${heldOut.status}`); if (dev.completed_count < options.minSamples) reason.push(`development sample count ${dev.completed_count} below ${options.minSamples}`); if (heldOut.completed_count < options.minSamples) reason.push(`held-out sample count ${heldOut.completed_count} below ${options.minSamples}`); if (dev.accuracy === null || heldOut.accuracy === null) reason.push('incomplete evaluation'); if (dev.unavailable.length || heldOut.unavailable.length) reason.push('unavailable cases present'); if (dev.accuracy !== null && heldOut.accuracy !== null && heldOut.accuracy + options.maxRegression < dev.accuracy) reason.push('held-out regression exceeds threshold'); return { pass: reason.length === 0, reason }
}
export async function runEvaluation(dataset: EvaluationDataset, input: { profile: string; configFingerprint: string; seed?: number; budgetUsd?: number; signal?: AbortSignal; estimateCost?: (test: EvaluationCase) => number; execute: (test: EvaluationCase) => Promise<Omit<CaseResult, 'case_id' | 'correct'> & { correct?: boolean | null }> }): Promise<EvaluationRun> {
  validateDataset(dataset); const run: EvaluationRun = { version: 1, id: randomUUID(), dataset_id: dataset.id, profile: input.profile, config_fingerprint: input.configFingerprint, seed: input.seed ?? 1, status: 'running', results: [], started_at: new Date().toISOString(), budget_usd: input.budgetUsd }
  for (const test of deterministicOrder(dataset.cases, run.seed)) {
    if (input.signal?.aborted) { run.status = 'cancelled'; break }
    const spent = run.results.reduce((sum, item) => sum + (item.cost_usd ?? 0), 0); const estimate = input.estimateCost?.(test) ?? 0
    if (input.budgetUsd !== undefined && spent + estimate > input.budgetUsd) { run.status = 'budget_exceeded'; break }
    let result: Omit<CaseResult, 'case_id' | 'correct'> & { correct?: boolean | null }
    try { result = await input.execute(test) } catch (error) { result = { correct: null, tool_errors: 1, human_intervention: false, error: error instanceof Error ? error.message : String(error) } }
    const checked: Omit<CaseResult, 'case_id'> = { ...result, correct: result.correct === undefined ? deterministicAssertion(test.expected, result.actual) : result.correct }; run.results.push({ case_id: test.id, ...checked }); const nextSpent = spent + (checked.cost_usd ?? 0); if (input.budgetUsd !== undefined && nextSpent > input.budgetUsd) { run.status = 'budget_exceeded'; break }
  }
  if (run.status === 'running') run.status = run.results.length === dataset.cases.length ? 'completed' : 'incomplete'; run.finished_at = new Date().toISOString(); return run
}
/** Execute a dataset using only JSON fixtures. No model, tool, network, or profile execution occurs. */
export function readFixture(ref: string, fixtureRoot = process.cwd()): Record<string, unknown> {
  if (ref.startsWith('inline:')) { const value = JSON.parse(ref.slice('inline:'.length)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`fixture '${ref}' must contain an object`); return value as Record<string, unknown> }
  const root = resolve(fixtureRoot); const path = isAbsolute(ref) ? resolve(ref) : resolve(root, ref); if (relative(root, path).startsWith('..')) throw new Error(`fixture path outside owned root: ${ref}`); if (!existsSync(path)) throw new Error(`fixture not found: ${ref}`); const value = JSON.parse(readFileSync(path, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`fixture '${ref}' must contain an object`); return value as Record<string, unknown>
}
export async function runFixtureEvaluation(dataset: EvaluationDataset, input: { profile: string; configFingerprint: string; seed?: number; budgetUsd?: number; signal?: AbortSignal; fixtureRoot?: string; estimateCost?: (test: EvaluationCase) => number }): Promise<EvaluationRun> {
  return runEvaluation(dataset, { ...input, execute: async test => {
    if (!test.fixture_refs.length) return { correct: null, tool_errors: 0, human_intervention: false, error: 'no fixture references' }
    try {
      const fixture = Object.assign({}, ...test.fixture_refs.map(ref => readFixture(ref, input.fixtureRoot))); const actual = (fixture.actual && typeof fixture.actual === 'object' ? fixture.actual : fixture) as Record<string, unknown>
      return { correct: typeof fixture.correct === 'boolean' ? fixture.correct : undefined, actual, cost_usd: typeof fixture.cost_usd === 'number' ? fixture.cost_usd : undefined, latency_ms: typeof fixture.latency_ms === 'number' ? fixture.latency_ms : undefined, tool_errors: typeof fixture.tool_errors === 'number' ? fixture.tool_errors : 0, human_intervention: fixture.human_intervention === true, error: typeof fixture.error === 'string' ? fixture.error : undefined }
    } catch (error) { return { correct: null, tool_errors: 1, human_intervention: false, error: error instanceof Error ? error.message : String(error) } }
  } })
}
export async function runExperiment(dataset: EvaluationDataset, input: { baseline: Omit<Parameters<typeof runEvaluation>[1], 'profile' | 'configFingerprint'> & { profile: string; configFingerprint: string }; candidate: Omit<Parameters<typeof runEvaluation>[1], 'profile' | 'configFingerprint'> & { profile: string; configFingerprint: string } }): Promise<{ baseline: EvaluationRun; candidate: EvaluationRun; comparison: Record<string, number | null> }> { const baseline = await runEvaluation(dataset, input.baseline); const candidate = await runEvaluation(dataset, input.candidate); return { baseline, candidate, comparison: compare(summarize(baseline), summarize(candidate)) } }

export class EvaluationStore {
  constructor(private readonly user: string, private readonly rootOverride?: string) {}
  private root(): string { return this.rootOverride ?? userPaths(this.user, '').evaluationsDir }
  saveDataset(dataset: EvaluationDataset): void { validateDataset(dataset); atomicWriteJson(join(this.root(), `dataset-${dataset.id}.json`), dataset) }
  saveRun(run: EvaluationRun): void { atomicWriteJson(join(this.root(), `run-${run.id}.json`), run) }
  saveExperiment(experiment: EvaluationExperiment): void { atomicWriteJson(join(this.root(), `experiment-${experiment.id}.json`), experiment) }
  getDataset(id: string): EvaluationDataset | null { const path = join(this.root(), `dataset-${id}.json`); if (!existsSync(path)) return null; const value = readJson<EvaluationDataset>(path); validateDataset(value); return value }
  datasets(): EvaluationDataset[] { if (!existsSync(this.root())) return []; return readdirSync(this.root()).filter(f => f.startsWith('dataset-')).flatMap(f => { try { const value = readJson<EvaluationDataset>(join(this.root(), f)); validateDataset(value); return [value] } catch { return [] } }) }
  runs(): EvaluationRun[] { if (!existsSync(this.root())) return []; return readdirSync(this.root()).filter(f => f.startsWith('run-')).flatMap(f => { try { return [readJson<EvaluationRun>(join(this.root(), f))] } catch { return [] } }) }
  experiments(): EvaluationExperiment[] { if (!existsSync(this.root())) return []; return readdirSync(this.root()).filter(f => f.startsWith('experiment-')).flatMap(f => { try { return [readJson<EvaluationExperiment>(join(this.root(), f))] } catch { return [] } }) }
}
