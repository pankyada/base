import { ListedServer, listServers, matchingServers, removeServerRecord, serverRegistryDir } from '../server/process-registry.js'

export interface ServerCommandOutput {
  log(message: string): void
  error(message: string): void
}

const defaultOutput: ServerCommandOutput = { log: console.log, error: console.error }

export async function runServerCommand(args: string[], output: ServerCommandOutput = defaultOutput, directory = serverRegistryDir()): Promise<number> {
  const command = args[0]
  if (command === 'list') {
    return listCommand(output, directory)
  }
  if (command === 'stop') {
    return stopCommand(args.slice(1), output, directory)
  }
  output.error('usage: harness server <list|stop [port|pid|profile|--all]>')
  return 1
}

function listCommand(output: ServerCommandOutput, directory: string): number {
  const servers = listServers(directory)
  if (!servers.length) {
    output.log('No registered harness servers.')
    return 0
  }
  output.log('PID\tPORT\tPROFILE\tSTATUS\tSTARTED\tCWD')
  for (const server of servers) output.log(formatServer(server))
  return 0
}

async function stopCommand(args: string[], output: ServerCommandOutput, directory: string): Promise<number> {
  const all = args.includes('--all')
  const selectors = args.filter(arg => arg !== '--all')
  if (all && selectors.length) {
    output.error('usage: harness server stop [port|pid|profile|--all]')
    return 1
  }
  if (selectors.length > 1) {
    output.error('stop accepts one selector')
    return 1
  }

  const selector = selectors[0]
  const matches = matchingServers(selector, directory)
  const running = matches.filter(server => server.status === 'running')
  const stale = matches.filter(server => server.status === 'stale')
  if (!selector && !all && running.length > 1) {
    output.error('multiple harness servers found; specify a port, pid, or profile')
    return 1
  }
  if (selector && !all && running.length > 1) {
    output.error(`selector matches multiple harness servers; use --all or a port/pid: ${selector}`)
    return 1
  }
  const targets = all ? matchingServers(undefined, directory).filter(server => server.status === 'running') : running.slice(0, 1)
  if (!targets.length) {
    for (const server of stale) {
      removeServerRecord(server, directory)
      output.log(`Removed stale harness server record for ${server.port}`)
    }
    if (stale.length) return 0
    output.error(selector ? `harness server not found: ${selector}` : 'no registered harness servers')
    return 1
  }

  let failed = false
  for (const server of targets) {
    try {
      process.kill(server.pid, 'SIGTERM')
      output.log(`Stop signal sent to harness server ${server.pid} (port ${server.port}, profile ${server.profile})`)
    } catch (error: any) {
      failed = true
      output.error(`failed to stop harness server ${server.pid}: ${error.message}`)
    }
  }
  return failed ? 1 : 0
}

function formatServer(server: ListedServer): string {
  return [server.pid, server.port, server.profile, server.status, server.started_at, server.cwd].join('\t')
}
