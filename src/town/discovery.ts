import { execFile as execFileCallback, spawn } from 'node:child_process'
import { lstat, realpath, readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TownProject, TownProjectSize } from './types.js'

const execFile = promisify(execFileCallback)
const IGNORED_DIRECTORIES = new Set([
  '.git', '.next', '.turbo', '.cache', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'node_modules', 'vendor', 'dist', 'build', 'target', 'coverage', '__pycache__',
  '.venv', 'venv', 'out', 'tmp', 'temp',
])
const TOWN_SIZE_MAX_ENTRIES = 10_000
const TOWN_SIZE_GIT_TIMEOUT_MS = 1_200
const MAX_INDEX_RECORD_BYTES = 64 * 1024

export interface TownDiscoveryOptions {
  existing?: Array<Pick<TownProject, 'id' | 'path'>>
  maxDepth?: number
  maxEntries?: number
  maxDurationMs?: number
  gitTimeoutMs?: number
  gitCommand?: string
}

export interface TownDiscoveryResult {
  status: 'complete' | 'partial' | 'error'
  root: string
  projects: TownProject[]
  skipped: string[]
  errors: Array<{ path: string; message: string }>
  warnings: string[]
  scanned_at: string
}

interface DirectoryItem { path: string; depth: number; parentProjectId?: string }
interface GitResult { ok: boolean; value: string; unavailable?: boolean }
interface IndexCountResult { status: 'complete' | 'partial' | 'error' | 'unknown'; count?: number; error?: string }

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function sanitizeRemote(value: string): string | undefined {
  const remote = value.trim()
  if (!remote) return undefined
  try {
    const parsed = new URL(remote)
    parsed.username = ''
    parsed.password = ''
    for (const key of [...parsed.searchParams.keys()]) if (/token|auth|pass|secret|key/i.test(key)) parsed.searchParams.delete(key)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote)
    if (scp) return `ssh://${scp[1]}/${scp[2]}`
    return undefined
  }
}

async function runGit(directory: string, args: string[], command: string, timeout: number): Promise<GitResult> {
  try {
    const result = await execFile(command, ['-C', directory, ...args], { timeout, maxBuffer: 256 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    return { ok: true, value: result.stdout.trim() }
  } catch (error) {
    const value = error as NodeJS.ErrnoException & { stdout?: string }
    return { ok: false, value: typeof value.stdout === 'string' ? value.stdout.trim() : '', unavailable: value.code === 'ENOENT' }
  }
}

async function inspectGit(directory: string, markerExists: boolean, command: string, timeout: number) {
  const top = await runGit(directory, ['rev-parse', '--show-toplevel'], command, timeout)
  if (!markerExists && !top.ok) return { project: false as const }
  if (top.ok) {
    try { if (await realpath(top.value) !== directory) return { project: false as const } }
    catch { return { project: false as const } }
  }
  const [head, dirty, lastCommit, remote] = await Promise.all([
    runGit(directory, ['rev-parse', '--short', 'HEAD'], command, timeout),
    runGit(directory, ['status', '--porcelain', '--untracked-files=normal'], command, timeout),
    runGit(directory, ['log', '-1', '--format=%cI'], command, timeout),
    runGit(directory, ['remote', 'get-url', 'origin'], command, timeout),
  ])
  const required = [top, head, dirty, lastCommit]
  const okCount = required.filter(item => item.ok).length
  const status = okCount === required.length ? 'known' : okCount > 0 ? 'partial' : 'unknown'
  const messages = required.filter(item => !item.ok).map(item => item.unavailable ? 'git executable unavailable' : 'git metadata could not be read')
  let lastCommitAt: string | undefined
  if (lastCommit.ok && lastCommit.value) {
    const date = new Date(lastCommit.value)
    if (Number.isFinite(date.getTime())) lastCommitAt = date.toISOString()
  }
  const safeRemote = remote.ok ? sanitizeRemote(remote.value) : undefined
  return {
    project: true as const,
    git: {
      status: status as 'known' | 'partial' | 'unknown',
      ...(head.ok && head.value ? { head: head.value } : {}),
      ...(dirty.ok ? { dirty: dirty.value.length > 0 } : {}),
      ...(lastCommitAt ? { last_commit_at: lastCommitAt } : {}),
      ...(messages.length ? { error: [...new Set(messages)].join('; ') } : {}),
    },
    ...(safeRemote ? { remote: safeRemote } : {}),
  }
}

function isIgnoredIndexedPath(path: string, nestedRepoPrefixes: string[]): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:\//.test(path)) return true
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || IGNORED_DIRECTORIES.has(segment))) return true
  return nestedRepoPrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

function killIndexProcess(child: ReturnType<typeof spawn>): void {
  if (child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); return }
    catch { /* fall back to the direct child */ }
  }
  try { child.kill('SIGKILL') } catch { /* process may have exited */ }
}

/** Count only regular files represented in the Git index; never inspect worktree contents. */
function countTrackedRegularFiles(directory: string, nestedRepoPrefixes: string[], deadline: number, command: string): Promise<IndexCountResult> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return Promise.resolve({ status: 'unknown', error: 'discovery deadline exhausted before size scan' })
  const timeout = Math.floor(Math.min(TOWN_SIZE_GIT_TIMEOUT_MS, remaining))
  if (timeout <= 0) return Promise.resolve({ status: 'unknown', error: 'discovery deadline exhausted before size scan' })

  return new Promise(resolveResult => {
    let settled = false
    let capped = false
    let timedOut = false
    let malformed = false
    let spawnError: NodeJS.ErrnoException | undefined
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    const eligible = new Set<string>()
    let timer: NodeJS.Timeout | undefined
    const finish = (result: IndexCountResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolveResult(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, ['-C', directory, 'ls-files', '--stage', '-z'], {
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
    } catch {
      finish({ status: 'error', error: 'Git index enumeration failed' })
      return
    }

    const inspectRecord = (record: Buffer) => {
      const separator = record.indexOf(0x09)
      if (separator <= 0 || separator === record.length - 1) return
      const fields = record.subarray(0, separator).toString('ascii').split(' ')
      if (fields.length !== 3 || (fields[0] !== '100644' && fields[0] !== '100755') || !/^[0-9a-f]+$/i.test(fields[1] ?? '') || fields[2] !== '0') return
      let path: string
      try { path = new TextDecoder('utf-8', { fatal: true }).decode(record.subarray(separator + 1)) }
      catch { return }
      if (isIgnoredIndexedPath(path, nestedRepoPrefixes) || eligible.has(path)) return
      eligible.add(path)
      if (eligible.size > TOWN_SIZE_MAX_ENTRIES) {
        capped = true
        killIndexProcess(child)
      }
    }

    child.on('error', error => { spawnError = error as NodeJS.ErrnoException })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || capped) return
      const combined = pending.length ? Buffer.concat([pending, chunk]) : chunk
      let start = 0
      let end = combined.indexOf(0, start)
      while (end !== -1) {
        inspectRecord(combined.subarray(start, end))
        if (capped) return
        start = end + 1
        end = combined.indexOf(0, start)
      }
      pending = combined.subarray(start)
      if (pending.length > MAX_INDEX_RECORD_BYTES) {
        malformed = true
        killIndexProcess(child)
      }
    })
    timer = setTimeout(() => {
      timedOut = true
      killIndexProcess(child)
    }, timeout)
    timer.unref()
    child.on('close', code => {
      if (capped) { finish({ status: 'partial', error: 'tracked-file entry cap reached' }); return }
      if (timedOut) { finish({ status: 'partial', error: 'Git index enumeration deadline reached' }); return }
      if (malformed || pending.length > 0) { finish({ status: 'error', error: 'Git index enumeration returned an unsafe path record' }); return }
      if (spawnError || code !== 0) {
        finish({ status: 'error', error: spawnError?.code === 'ENOENT' ? 'git executable unavailable' : 'Git index enumeration failed' })
        return
      }
      finish({ status: 'complete', count: eligible.size })
    })
  })
}

async function measureProjectSize(project: TownProject, projects: TownProject[], deadline: number, gitCommand: string): Promise<TownProjectSize> {
  const measuredAt = new Date().toISOString()
  const nestedRepoPrefixes = projects
    .filter(other => other.path !== project.path && isWithin(project.path, other.path))
    .map(other => relative(project.path, other.path).split(sep).join('/'))
  const measured = await countTrackedRegularFiles(project.path, nestedRepoPrefixes, deadline, gitCommand)
  return {
    source: 'git_tracked_regular_files',
    status: measured.status,
    ...(measured.status === 'complete' && Number.isFinite(measured.count) && measured.count! >= 0 ? { tracked_regular_files: measured.count } : {}),
    measured_at: measuredAt,
    max_entries: TOWN_SIZE_MAX_ENTRIES,
    ...(measured.error ? { error: measured.error } : {}),
  }
}

/** Discover bounded local Git repositories without following symlinks or modifying any checkout. */
export async function discoverTownProjects(inputRoot: string, options: TownDiscoveryOptions = {}): Promise<TownDiscoveryResult> {
  const scannedAt = new Date().toISOString()
  const result: TownDiscoveryResult = { status: 'complete', root: '', projects: [], skipped: [], errors: [], warnings: [], scanned_at: scannedAt }
  if (!isAbsolute(inputRoot)) {
    result.status = 'error'
    result.errors.push({ path: inputRoot, message: 'discovery root must be absolute' })
    return result
  }
  let root: string
  try { root = await realpath(resolve(inputRoot)) }
  catch (error) {
    result.status = 'error'
    result.errors.push({ path: resolve(inputRoot), message: error instanceof Error ? error.message : 'cannot resolve discovery root' })
    return result
  }
  result.root = root
  try {
    const rootInfo = await lstat(root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('discovery root must be a real directory')
  } catch (error) {
    result.status = 'error'
    result.errors.push({ path: root, message: error instanceof Error ? error.message : 'invalid discovery root' })
    return result
  }

  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? 8))
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 5000))
  const deadline = Date.now() + Math.max(100, options.maxDurationMs ?? 10_000)
  const gitCommand = options.gitCommand ?? 'git'
  const gitTimeout = Math.max(50, Math.min(options.gitTimeoutMs ?? 1200, 5000))
  const oldIds = new Map((options.existing ?? []).map(project => [resolve(project.path), project.id]))
  const seen = new Set<string>()
  const queue: DirectoryItem[] = [{ path: root, depth: 0 }]
  let entriesSeen = 0

  while (queue.length) {
    if (Date.now() >= deadline) {
      result.warnings.push('time limit reached')
      result.status = 'partial'
      break
    }
    const item = queue.shift()!
    if (seen.has(item.path)) continue
    seen.add(item.path)
    let marker = false
    try {
      const markerInfo = await lstat(join(item.path, '.git'))
      marker = (markerInfo.isDirectory() || markerInfo.isFile()) && !markerInfo.isSymbolicLink()
    } catch { /* directories without their own marker are not projects */ }
    const inspected = marker
      ? await inspectGit(item.path, marker, gitCommand, Math.min(gitTimeout, Math.max(100, deadline - Date.now())))
      : { project: false as const }
    let parentProjectId = item.parentProjectId
    if (inspected.project) {
      const id = oldIds.get(item.path) ?? randomUUID()
      const project: TownProject = {
        id,
        path: item.path,
        ...(parentProjectId ? { parent_id: parentProjectId } : {}),
        git: inspected.git,
        scanned_at: scannedAt,
        display: { name: basename(item.path) || item.path },
        ...(inspected.remote ? { remote: inspected.remote } : {}),
      }
      result.projects.push(project)
      parentProjectId = id
    }
    if (item.depth >= maxDepth) {
      try {
        const children = await readdir(item.path)
        if (children.some(name => !IGNORED_DIRECTORIES.has(name))) {
          result.warnings.push('depth limit reached')
          result.status = 'partial'
        }
      } catch (error) {
        result.errors.push({ path: item.path, message: error instanceof Error ? error.message : 'cannot read directory' })
        result.status = 'partial'
      }
      continue
    }
    let names: string[]
    try { names = await readdir(item.path) }
    catch (error) {
      result.errors.push({ path: item.path, message: error instanceof Error ? error.message : 'cannot read directory' })
      result.status = 'partial'
      continue
    }
    names.sort((a, b) => a.localeCompare(b))
    for (const name of names) {
      if (IGNORED_DIRECTORIES.has(name)) continue
      entriesSeen += 1
      if (entriesSeen > maxEntries) {
        result.warnings.push('entry limit reached')
        result.status = 'partial'
        queue.length = 0
        break
      }
      const child = join(item.path, name)
      if (!isWithin(root, child)) {
        result.skipped.push(child)
        continue
      }
      try {
        const info = await lstat(child)
        if (info.isSymbolicLink()) { result.skipped.push(child); continue }
        if (info.isDirectory()) queue.push({ path: child, depth: item.depth + 1, parentProjectId })
      } catch (error) {
        result.errors.push({ path: child, message: error instanceof Error ? error.message : 'cannot inspect path' })
        result.status = 'partial'
      }
    }
  }

  result.projects.sort((a, b) => a.path.localeCompare(b.path))
  const byPath = new Map(result.projects.map(project => [project.path, project]))
  for (const project of result.projects) {
    const parentPath = resolve(project.path, '..')
    if (!project.parent_id) {
      for (let cursor = parentPath; isWithin(root, cursor) && cursor !== root; cursor = resolve(cursor, '..')) {
        const parent = byPath.get(cursor)
        if (parent) { project.parent_id = parent.id; break }
      }
    }
  }
  for (const project of result.projects) project.size = await measureProjectSize(project, result.projects, deadline, gitCommand)
  return result
}
