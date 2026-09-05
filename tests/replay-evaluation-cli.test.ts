import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runReplayCommand } from '../src/cli/replay.js'
import { runEvaluationCommandAsync } from '../src/cli/evaluation.js'
import { createDataset, EvaluationStore } from '../src/evaluation/index.js'
import { markCheckpoint, newJournal, recordEvent, exportJournal } from '../src/replay/index.js'

describe('R5/R6 CLI execution', () => {
  it('executes replay playback and branch commands from a journal file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-cli-replay-')); const journal = newJournal({ user: 'test', session_id: 's', profile: 'p', config_fingerprint: 'c', mode: 'fixture' }); recordEvent(journal, 'result', 'ok'); markCheckpoint(journal, 'done'); const file = join(root, 'journal.json'); writeFileSync(file, JSON.stringify(exportJournal(journal))); const output: string[] = []; expect(await runReplayCommand(['playback', '--file', file], { stdout: line => output.push(line) })).toBe(0); expect(JSON.parse(output[0]).events).toBe(1); output.length = 0; expect(await runReplayCommand(['branch', '--file', file, '--checkpoint', 'done'], { stdout: line => output.push(line) })).toBe(0); expect(JSON.parse(output[0]).parent_run_id).toBe(journal.id)
  })
  it('runs and compares pinned fixture profiles from CLI', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-cli-eval-')); const fixtureRoot = mkdtempSync(join(tmpdir(), 'harness-cli-fixture-')); writeFileSync(join(fixtureRoot, 'case.json'), JSON.stringify({ actual: { answer: 'ok' } })); const store = new EvaluationStore('test', root); const dataset = createDataset('d', [{ input: 'x', fixture_refs: ['case.json'], expected: { answer: 'ok' }, split: 'development' }]); store.saveDataset(dataset); const output: string[] = []; expect(await runEvaluationCommandAsync(['run', '--store-root', root, '--fixture-root', fixtureRoot, '--dataset', dataset.id, '--profile', 'p', '--config', 'cfg'], { stdout: line => output.push(line) })).toBe(0); expect(JSON.parse(output[0]).summary.accuracy).toBe(1); output.length = 0; expect(await runEvaluationCommandAsync(['experiment', '--store-root', root, '--fixture-root', fixtureRoot, '--dataset', dataset.id, '--baseline-profile', 'p', '--baseline-config', 'b', '--candidate-profile', 'q', '--candidate-config', 'c'], { stdout: line => output.push(line) })).toBe(0); expect(JSON.parse(output[0]).experiment.comparison.accuracy_delta).toBe(0)
  })
})
