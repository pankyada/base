import { existsSync, readFileSync, realpathSync, statSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import { resolveSkillsDirs } from '../skills/loader.js'
import { realpathForContainment } from '../tools/predicates.js'

const CONTEXT_FILENAMES = ['AGENTS.md', 'CLAUDE.md'] as const
const DEFAULT_MAX_BYTES = 32 * 1024

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function safeContextFile(root: string, filename: string): string | null {
  const path = join(root, filename)
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    const resolvedRoot = realpathSync(root)
    const resolvedFile = realpathForContainment(path)
    return isWithin(resolvedRoot, resolvedFile) ? resolvedFile : null
  } catch {
    return null
  }
}

/** Resolve project instruction files from broadest to most-specific roots. */
export function resolveContextFiles(cwd = process.cwd()): string[] {
  const roots = resolveSkillsDirs(cwd).map(dir => resolve(dir, '..', '..'))

  const byName = new Map<string, string>()
  for (const root of roots) {
    for (const filename of CONTEXT_FILENAMES) {
      const file = safeContextFile(root, filename)
      if (file) byName.set(filename, file)
    }
  }
  return [...byName.values()]
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8')
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** Load project instructions with visible source labels and a hard byte cap. */
export function loadProjectContext(opts: { maxBytes?: number; cwd?: string } = {}): string {
  const maxBytes = Math.max(0, opts.maxBytes ?? DEFAULT_MAX_BYTES)
  if (maxBytes === 0) return ''

  let assembled = ''
  for (const file of resolveContextFiles(opts.cwd ?? process.cwd())) {
    let body: string
    try {
      body = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    const block = `\n\n--- Project context: ${file} ---\n${body}\n`
    if (byteLength(assembled) + byteLength(block) <= maxBytes) {
      assembled += block
      continue
    }

    const notice = `\n[Project context truncated: ${file}]\n`
    const noticeBytes = byteLength(notice)
    if (noticeBytes >= maxBytes) return truncateUtf8(notice, maxBytes)

    const contentBytes = maxBytes - noticeBytes
    assembled = truncateUtf8(assembled + block, contentBytes)
    return assembled + notice
  }

  return assembled
}
