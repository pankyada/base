import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverTownProjects } from '../src/town/discovery.js'

const roots: string[] = []
function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-town-scan-'))
  roots.push(root)
  return root
}
function repo(path: string, name = 'project'): void {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '-q', path])
  writeFileSync(join(path, 'README.md'), name)
  execFileSync('git', ['-C', path, '-c', 'user.name=Town Test', '-c', 'user.email=town@example.invalid', 'add', 'README.md'])
  execFileSync('git', ['-C', path, '-c', 'user.name=Town Test', '-c', 'user.email=town@example.invalid', 'commit', '-qm', 'initial'])
}

function trackedRepo(path: string, count: number): void {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '-q', path])
  execFileSync('git', ['-C', path, '-c', 'user.name=Town Test', '-c', 'user.email=town@example.invalid', 'commit', '--allow-empty', '-qm', 'initial'])
  for (let index = 0; index < count; index++) writeFileSync(join(path, `tracked-${index}.txt`), '')
  if (count) execFileSync('git', ['-C', path, 'add', '--all'])
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('town repository discovery', () => {
  it('finds nested worktrees, reads actual Git state and preserves project IDs on refresh', async () => {
    const root = tempDir()
    repo(root, 'parent')
    const nested = join(root, 'apps', 'nested')
    repo(nested, 'nested')

    const first = await discoverTownProjects(root)
    expect(first.status).toBe('complete')
    const canonicalRoot = realpathSync(root)
    const canonicalNested = realpathSync(nested)
    expect(first.projects.map(project => project.path)).toEqual([canonicalRoot, canonicalNested])
    expect(first.projects[0].git).toMatchObject({ status: 'known', dirty: true, head: expect.any(String), last_commit_at: expect.any(String) })
    expect(first.projects[1].parent_id).toBe(first.projects[0].id)

    const refreshed = await discoverTownProjects(root, { existing: first.projects })
    expect(refreshed.projects.map(project => project.id)).toEqual(first.projects.map(project => project.id))
  })

  it('does not follow symlinks or enter dependency/cache directories', async () => {
    const root = tempDir()
    repo(root)
    const outside = join(tempDir(), 'secret-repo')
    repo(outside, 'outside')
    symlinkSync(outside, join(root, 'linked'), 'dir')
    repo(join(root, 'node_modules', 'nested'), 'ignored')
    repo(join(root, '.next', 'nested'), 'ignored')

    const result = await discoverTownProjects(root)
    expect(result.projects.map(project => project.path)).toEqual([realpathSync(root)])
    expect(result.skipped.some(path => path.endsWith('/linked'))).toBe(true)
  })

  it('returns explicit partial status when traversal reaches configured caps', async () => {
    const root = tempDir()
    repo(root)
    repo(join(root, 'one'))
    repo(join(root, 'two'))

    const result = await discoverTownProjects(root, { maxEntries: 1 })
    expect(result.status).toBe('partial')
    expect(result.warnings).toContain('entry limit reached')
  })

  it('never reports the same canonical repository twice', async () => {
    const root = tempDir()
    repo(root)
    const result = await discoverTownProjects(root)
    expect(new Set(result.projects.map(project => project.path)).size).toBe(result.projects.length)
  })

  it('reports exact Git-index size at every approved building threshold', async () => {
    const root = tempDir()
    const counts = [0, 99, 100, 499, 500, 1_999, 2_000]
    for (const count of counts) trackedRepo(join(root, `files-${count}`), count)

    const result = await discoverTownProjects(root, { maxEntries: 100_000 })
    expect(result.status).toBe('complete')
    expect(result.projects.map(project => project.size?.tracked_regular_files).sort((a, b) => (a ?? -1) - (b ?? -1))).toEqual(counts)
    for (const project of result.projects) {
      expect(project.size).toMatchObject({ source: 'git_tracked_regular_files', status: 'complete', max_entries: 10_000 })
      expect(project.size?.measured_at).toMatch(/^\d{4}-\d\d-/)
    }
  }, 30_000)

  it('counts index entries without reading file content, following symlinks, ignored paths or gitlinks', async () => {
    const root = tempDir()
    repo(root)
    const normal = join(root, 'src', 'kept.ts')
    const ignored = join(root, 'node_modules', 'forced.js')
    const linked = join(root, 'linked-file')
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    writeFileSync(normal, 'source')
    writeFileSync(ignored, 'ignored')
    const outside = join(tempDir(), 'outside.txt')
    writeFileSync(outside, 'outside')
    symlinkSync(outside, linked)
    execFileSync('git', ['-C', root, 'add', 'src/kept.ts'])
    execFileSync('git', ['-C', root, 'add', '-f', 'node_modules/forced.js', 'linked-file'])
    const nested = join(root, 'nested-repo')
    trackedRepo(nested, 1)
    execFileSync('git', ['-C', root, 'add', '-f', 'nested-repo/tracked-0.txt'])
    const head = execFileSync('git', ['-C', nested, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    execFileSync('git', ['-C', root, 'update-index', '--add', '--cacheinfo', `160000,${head},nested-gitlink`])
    rmSync(normal)

    const result = await discoverTownProjects(root)
    const parent = result.projects.find(project => project.path === realpathSync(root))
    const child = result.projects.find(project => project.path === realpathSync(nested))
    expect(parent?.size?.tracked_regular_files).toBe(2)
    expect(child?.size?.tracked_regular_files).toBe(1)
  })

  it('marks capped Git size enumeration partial without publishing an exact count', async () => {
    const root = tempDir()
    trackedRepo(join(root, 'large'), 10_001)
    const projectPath = join(root, 'large')
    const result = await discoverTownProjects(root, { maxDurationMs: 20_000 })
    const project = result.projects.find(item => item.path === realpathSync(projectPath))
    expect(project?.size).toMatchObject({ source: 'git_tracked_regular_files', status: 'partial', max_entries: 10_000 })
    expect(project?.size?.tracked_regular_files).toBeUndefined()
  }, 30_000)

  it('keeps Git measurement failure and timeout distinct from an exact zero', async () => {
    const root = tempDir()
    trackedRepo(join(root, 'failed'), 1)
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const failingGit = join(tempDir(), 'git-fail')
    writeFileSync(failingGit, `#!/bin/sh\ncase "$*" in *"ls-files --stage"*) exit 3;; esac\nexec "${realGit}" "$@"\n`)
    chmodSync(failingGit, 0o755)
    const failed = await discoverTownProjects(root, { gitCommand: failingGit })
    expect(failed.projects[0].size).toMatchObject({ status: 'error', source: 'git_tracked_regular_files' })
    expect(failed.projects[0].size?.tracked_regular_files).toBeUndefined()

    const slowGit = join(tempDir(), 'git-slow')
    writeFileSync(slowGit, `#!/bin/sh\ncase "$*" in *"ls-files --stage"*) sleep 2;; esac\nexec "${realGit}" "$@"\n`)
    chmodSync(slowGit, 0o755)
    const started = Date.now()
    const timed = await discoverTownProjects(root, { gitCommand: slowGit, gitTimeoutMs: 50, maxDurationMs: 500 })
    expect(timed.projects[0].size).toMatchObject({ status: 'partial', source: 'git_tracked_regular_files' })
    expect(timed.projects[0].size?.tracked_regular_files).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1_000)
  }, 10_000)

  it('applies the fixed 1,200 ms Git size timeout inside a longer discovery window', async () => {
    const root = tempDir()
    trackedRepo(join(root, 'slow'), 1)
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const slowGit = join(tempDir(), 'git-slow-cap')
    writeFileSync(slowGit, `#!/bin/sh\ncase "$*" in *"ls-files --stage"*) sleep 2;; esac\nexec "${realGit}" "$@"\n`)
    chmodSync(slowGit, 0o755)
    const started = Date.now()
    const result = await discoverTownProjects(root, { gitCommand: slowGit, maxDurationMs: 5_000 })
    const elapsed = Date.now() - started
    expect(result.projects[0].size).toMatchObject({ status: 'partial', max_entries: 10_000 })
    expect(result.projects[0].size?.tracked_regular_files).toBeUndefined()
    expect(elapsed).toBeGreaterThanOrEqual(1_000)
    expect(elapsed).toBeLessThan(2_000)
  }, 5_000)
})
