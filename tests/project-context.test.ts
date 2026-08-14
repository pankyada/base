import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({ home: '' }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => testState.home }
})

import { loadProjectContext, resolveContextFiles } from '../src/context/project-context.js'

describe('project context discovery', () => {
  const originalCwd = process.cwd()
  let home: string
  let repo: string
  let subProject: string
  let folder: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'harness-context-home-'))
    repo = mkdtempSync(join(tmpdir(), 'harness-context-repo-'))
    subProject = join(repo, 'sub-project')
    folder = join(subProject, 'folder')
    mkdirSync(folder, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: repo })
    testState.home = home
    process.chdir(folder)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  })

  it('returns no files when every discovery level is empty', () => {
    expect(resolveContextFiles(folder)).toEqual([])
    expect(loadProjectContext()).toBe('')
  })

  it('uses the most-specific AGENTS and CLAUDE files at each precedence level', () => {
    const levels = [home, repo, subProject, folder]
    for (const [index, root] of levels.entries()) {
      writeFileSync(join(root, 'AGENTS.md'), `agents-${index}`)
      writeFileSync(join(root, 'CLAUDE.md'), `claude-${index}`)
    }

    expect(resolveContextFiles(folder)).toEqual([
      realpathSync(join(folder, 'AGENTS.md')),
      realpathSync(join(folder, 'CLAUDE.md')),
    ])
    expect(loadProjectContext()).toContain('agents-3')
    expect(loadProjectContext()).toContain('claude-3')
    expect(loadProjectContext()).not.toContain('agents-0')

    unlinkSync(join(folder, 'AGENTS.md'))
    unlinkSync(join(folder, 'CLAUDE.md'))
    expect(resolveContextFiles(folder)).toEqual([
      realpathSync(join(subProject, 'AGENTS.md')),
      realpathSync(join(subProject, 'CLAUDE.md')),
    ])

    unlinkSync(join(subProject, 'AGENTS.md'))
    unlinkSync(join(subProject, 'CLAUDE.md'))
    expect(resolveContextFiles(folder)).toEqual([
      realpathSync(join(repo, 'AGENTS.md')),
      realpathSync(join(repo, 'CLAUDE.md')),
    ])

    unlinkSync(join(repo, 'AGENTS.md'))
    unlinkSync(join(repo, 'CLAUDE.md'))
    expect(resolveContextFiles(folder)).toEqual([
      realpathSync(join(home, 'AGENTS.md')),
      realpathSync(join(home, 'CLAUDE.md')),
    ])
  })

  it('ignores a context symlink that resolves outside its discovery root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'harness-context-outside-'))
    const outsideFile = join(outside, 'AGENTS.md')
    writeFileSync(outsideFile, 'secret outside rule')
    symlinkSync(outsideFile, join(folder, 'AGENTS.md'))

    expect(resolveContextFiles(folder)).toEqual([])
    expect(loadProjectContext()).toBe('')
    rmSync(outside, { recursive: true, force: true })
  })

  it('enforces the assembled byte cap and names the file that was cut', () => {
    const file = join(folder, 'AGENTS.md')
    writeFileSync(file, 'x'.repeat(512))
    const maxBytes = 180
    const loaded = loadProjectContext({ maxBytes })

    expect(Buffer.byteLength(loaded, 'utf8')).toBeLessThanOrEqual(maxBytes)
    expect(loaded).toContain(`[Project context truncated: ${realpathSync(file)}]`)
    expect(readFileSync(file, 'utf8')).toHaveLength(512)
  })
})
