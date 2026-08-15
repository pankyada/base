import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface ServerRecord {
  pid: number
  port: number
  profile: string
  profiles: string[]
  started_at: string
  cwd: string
}

export interface ListedServer extends ServerRecord {
  status: 'running' | 'stale'
}

export function serverRegistryDir(): string {
  return process.env.HARNESS_SERVER_REGISTRY_DIR ?? join(homedir(), '.harness', 'servers')
}

function statePath(port: number, directory: string): string {
  return join(directory, `${port}.json`)
}

function readRecord(path: string): ServerRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ServerRecord>
    if (
      typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0 ||
      typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port <= 0 ||
      typeof value.profile !== 'string' || !value.profile ||
      !Array.isArray(value.profiles) || value.profiles.some(item => typeof item !== 'string') ||
      typeof value.started_at !== 'string' || typeof value.cwd !== 'string'
    ) return undefined
    return value as ServerRecord
  } catch {
    return undefined
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    return error?.code === 'EPERM'
  }
}

export function registerServer(record: ServerRecord, directory = serverRegistryDir()): void {
  mkdirSync(directory, { recursive: true })
  const path = statePath(record.port, directory)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
  renameSync(temporary, path)
}

export function unregisterServer(port: number, pid = process.pid, directory = serverRegistryDir()): void {
  const path = statePath(port, directory)
  const record = readRecord(path)
  if (!record || record.pid !== pid) return
  try { unlinkSync(path) } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function listServers(directory = serverRegistryDir()): ListedServer[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .map(name => readRecord(join(directory, name)))
    .filter((record): record is ServerRecord => Boolean(record))
    .map(record => ({ ...record, status: (processIsAlive(record.pid) ? 'running' : 'stale') as ListedServer['status'] }))
    .sort((left, right) => left.port - right.port)
}

export function removeServerRecord(record: ServerRecord, directory = serverRegistryDir()): void {
  try { unlinkSync(statePath(record.port, directory)) } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function matchingServers(selector: string | undefined, directory = serverRegistryDir()): ListedServer[] {
  const servers = listServers(directory)
  if (!selector) return servers.filter(server => server.status === 'running')
  return servers.filter(server =>
    server.port.toString() === selector ||
    server.pid.toString() === selector ||
    server.profile === selector ||
    server.profiles.includes(selector)
  )
}

export function serverRecordFor(port: number, profile: string, profiles: string[], cwd: string): ServerRecord {
  return { pid: process.pid, port, profile, profiles, started_at: new Date().toISOString(), cwd }
}
