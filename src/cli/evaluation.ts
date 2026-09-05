import { readFileSync } from 'node:fs'
import { compare, EvaluationStore, promotionGate, runFixtureEvaluation, summarize, type EvaluationDataset, type EvaluationRun, type EvaluationExperiment } from '../evaluation/index.js'
import { randomUUID } from 'node:crypto'

function arg(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }

/** CLI read/compare/gate surface. Execution is supplied by the runtime command wiring. */
export function runEvaluationCommand(args: string[], io: { stdout?: (line: string) => void; stderr?: (line: string) => void } = {}): number {
  const out = io.stdout ?? console.log; const error = io.stderr ?? console.error; const user = arg(args, '--user') ?? process.env.HARNESS_USER ?? 'default'; const store = new EvaluationStore(user, arg(args, '--store-root')); const command = args[0] ?? 'list'
  try {
    if (command === 'list') { out(JSON.stringify({ datasets: store.datasets(), runs: store.runs(), experiments: store.experiments() })); return 0 }
    if (command === 'compare') { const baselineId = arg(args, '--baseline'); const candidateId = arg(args, '--candidate'); if (!baselineId || !candidateId) { error('compare requires --baseline <run> --candidate <run>'); return 2 }; const baseline = store.runs().find(run => run.id === baselineId); const candidate = store.runs().find(run => run.id === candidateId); if (!baseline || !candidate) { error('evaluation run not found'); return 1 }; out(JSON.stringify({ baseline: summarize(baseline), candidate: summarize(candidate), deltas: compare(summarize(baseline), summarize(candidate)) })); return 0 }
    if (command === 'gate') { const development = loadRun(store.runs(), arg(args, '--development')); const heldOut = loadRun(store.runs(), arg(args, '--held-out')); const minSamples = Number(arg(args, '--min-samples') ?? 1); const maxRegression = Number(arg(args, '--max-regression') ?? 0); out(JSON.stringify(promotionGate(summarize(development), summarize(heldOut), { minSamples, maxRegression }))); return 0 }
    if (command === 'dataset') { const file = arg(args, '--file'); if (!file) { error('dataset requires --file <dataset.json>'); return 2 }; const dataset = JSON.parse(readFileSync(file, 'utf8')) as EvaluationDataset; store.saveDataset(dataset); out(JSON.stringify({ saved: dataset.id })); return 0 }
    if (command === 'run' || command === 'experiment') { error('evaluation run requires async command dispatch; call runEvaluationCommandAsync'); return 2 }
    error(`unknown eval command: ${command}`); return 2
  } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)); return 1 }
}

/** Async execution entrypoint used by the CLI dispatcher for fixture-backed runs. */
export async function runEvaluationCommandAsync(args: string[], io: { stdout?: (line: string) => void; stderr?: (line: string) => void } = {}): Promise<number> {
  const out = io.stdout ?? console.log; const error = io.stderr ?? console.error; const user = arg(args, '--user') ?? process.env.HARNESS_USER ?? 'default'; const store = new EvaluationStore(user, arg(args, '--store-root')); const command = args[0] ?? 'list'
  try {
    if (command !== 'run' && command !== 'experiment') return runEvaluationCommand(args, io)
    const datasetId = arg(args, '--dataset'); if (!datasetId) { error('evaluation run requires --dataset <id>'); return 2 }; const dataset = store.getDataset(datasetId); if (!dataset) { error(`evaluation dataset not found: ${datasetId}`); return 1 }
    const fixtureRoot = arg(args, '--fixture-root'); const seed = Number(arg(args, '--seed') ?? 1); const budgetUsd = arg(args, '--budget') === undefined ? undefined : Number(arg(args, '--budget')); const controller = new AbortController(); const cancelAfter = arg(args, '--cancel-after-ms'); const timer = cancelAfter ? setTimeout(() => controller.abort(), Number(cancelAfter)) : undefined
    if (command === 'run') { const profile = arg(args, '--profile'); const configFingerprint = arg(args, '--config'); if (!profile || !configFingerprint) { error('evaluation run requires pinned --profile and --config'); return 2 }; const run = await runFixtureEvaluation(dataset, { profile, configFingerprint, fixtureRoot, seed, budgetUsd, signal: controller.signal }); if (timer) clearTimeout(timer); store.saveRun(run); out(JSON.stringify({ run, summary: summarize(run) })); return run.status === 'completed' ? 0 : 1 }
    const baselineProfile = arg(args, '--baseline-profile'); const baselineConfig = arg(args, '--baseline-config'); const candidateProfile = arg(args, '--candidate-profile'); const candidateConfig = arg(args, '--candidate-config'); if (!baselineProfile || !baselineConfig || !candidateProfile || !candidateConfig) { error('evaluation experiment requires pinned baseline/candidate profile and config'); return 2 }
    const baseline = await runFixtureEvaluation(dataset, { profile: baselineProfile, configFingerprint: baselineConfig, fixtureRoot, seed, budgetUsd, signal: controller.signal }); const candidate = await runFixtureEvaluation(dataset, { profile: candidateProfile, configFingerprint: candidateConfig, fixtureRoot, seed, budgetUsd, signal: controller.signal }); if (timer) clearTimeout(timer); store.saveRun(baseline); store.saveRun(candidate); const experiment: EvaluationExperiment = { version: 1, id: randomUUID(), dataset_id: dataset.id, baseline_run_id: baseline.id, candidate_run_id: candidate.id, created_at: new Date().toISOString(), comparison: compare(summarize(baseline), summarize(candidate)) }; store.saveExperiment(experiment); out(JSON.stringify({ experiment, baseline: summarize(baseline), candidate: summarize(candidate) })); return baseline.status === 'completed' && candidate.status === 'completed' ? 0 : 1
  } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)); return 1 }
}

function loadRun(runs: EvaluationRun[], id: string | undefined): EvaluationRun { const run = id && runs.find(item => item.id === id); if (!run) throw new Error(`evaluation run not found: ${id ?? '(missing)'}`); return run }
