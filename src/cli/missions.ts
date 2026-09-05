import { MissionStore } from '../missions/index.js'
import { sanitizeUserId } from '../session/user-paths.js'

export function runMissionCommand(args: string[], output: { log(message: string): void; error(message: string): void } = { log: console.log, error: console.error }): number {
  const user = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous'); const store = new MissionStore(user); const command = args[0]
  if (command === 'list') { output.log(JSON.stringify(store.list().map(mission => ({ id: mission.id, status: mission.status, outcome: mission.outcome, revision: mission.revision })), null, 2)); return 0 }
  if (command === 'show' && args[1]) { const mission = store.get(args[1]); if (!mission) { output.error('mission not found'); return 1 }; output.log(JSON.stringify({ mission, receipts: store.receipts(mission.id) }, null, 2)); return 0 }
  output.error('usage: harness mission <list|show ID>'); return 1
}
