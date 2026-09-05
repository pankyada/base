import { readFileSync } from 'node:fs'
import { branch, exportJournal, importJournal, playback, type RunJournal } from '../replay/index.js'

function arg(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }

/** CLI handler kept separate so the main client can wire commands without importing replay internals. */
export async function runReplayCommand(args: string[], io: { stdout?: (line: string) => void; stderr?: (line: string) => void } = {}): Promise<number> {
  const out = io.stdout ?? console.log; const error = io.stderr ?? console.error; const input = arg(args, '--file')
  if (!input) { error('replay requires --file <journal.json>'); return 2 }
  try {
    const imported = importJournal(JSON.parse(readFileSync(input, 'utf8'))); const journal = imported.journal; const command = args[0] ?? 'playback'
    if (command === 'playback') { const events: unknown[] = []; const result = await playback(journal, event => { events.push(event) }); out(JSON.stringify({ mode: 'playback', events: result.events, journal_id: journal.id })); return 0 }
    if (command === 'export') { const output = arg(args, '--output'); out(JSON.stringify(exportJournal(journal, output))); return 0 }
    if (command === 'branch') { const checkpoint = arg(args, '--checkpoint'); if (!checkpoint) { error('branch requires --checkpoint <name>'); return 2 }; const branched = branch(journal, checkpoint, { profile: arg(args, '--profile'), config_fingerprint: arg(args, '--config') }); out(JSON.stringify(branched)); return 0 }
    error(`unknown replay command: ${command}`); return 2
  } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)); return 1 }
}

export function parseJournal(text: string): RunJournal { return importJournal(JSON.parse(text)).journal }
