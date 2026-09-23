import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FIXED_HOME = mkdtempSync(join(tmpdir(), 'harness-playbook-home-'))

// dirs() (src/workflow/playbook.ts) reads homedir() at call time, so mocking
// 'os' before importing the module under test pins the "user" playbook root
// to an empty, private directory — otherwise a real ~/.agents/playbooks on
// the machine running the suite could leak into (or override) these
// precedence assertions.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => FIXED_HOME }
})

const { clearPlaybookCache, listPlaybooks, loadPlaybook } = await import('../src/workflow/playbook.js')

function writePlaybook(dir: string, name: string, body: string): void {
  const target = join(dir, name)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'PLAYBOOK.md'), body, 'utf8')
}

describe('listPlaybooks', () => {
  let originalCwd: string
  let base: string
  let child: string

  beforeEach(() => {
    clearPlaybookCache()
    originalCwd = process.cwd()
    base = mkdtempSync(join(tmpdir(), 'harness-playbook-base-'))
    child = join(base, 'work')
    mkdirSync(child, { recursive: true })
    process.chdir(child)
    // Force-clear again now that cwd/homedir are pinned, since dirs() caches
    // on first call and loadPlaybook/listPlaybooks in beforeEach could race
    // with any prior cached resolution.
    clearPlaybookCache()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(base, { recursive: true, force: true })
    rmSync(join(FIXED_HOME, '.agents'), { recursive: true, force: true })
    clearPlaybookCache()
  })

  it('discovers every <dir>/<name>/PLAYBOOK.md across resolvePlaybookDirs and always includes builtin generic', () => {
    writePlaybook(join(child, '.agents', 'playbooks'), 'coding', '---\nname: coding\ndescription: cwd coding\n---\n')
    writePlaybook(join(FIXED_HOME, '.agents', 'playbooks'), 'research', '---\nname: research\ndescription: home research\n---\n')

    const playbooks = listPlaybooks()
    const names = playbooks.map(p => p.name)
    expect(names).toContain('generic')
    expect(names).toContain('coding')
    expect(names).toContain('research')
  })

  it('returns a deterministic, name-sorted, de-duplicated list', () => {
    writePlaybook(join(child, '.agents', 'playbooks'), 'zeta', '---\nname: zeta\n---\n')
    writePlaybook(join(child, '.agents', 'playbooks'), 'alpha', '---\nname: alpha\n---\n')
    writePlaybook(join(base, '.agents', 'playbooks'), 'alpha', '---\nname: alpha\ndescription: parent alpha\n---\n')

    const names = listPlaybooks().map(p => p.name)
    expect(names).toEqual([...names].sort())
    expect(names.filter(n => n === 'alpha')).toHaveLength(1)
  })

  it('gives the most specific directory precedence, matching loadPlaybook', () => {
    writePlaybook(join(base, '.agents', 'playbooks'), 'coding', '---\nname: coding\ndescription: parent coding\n---\n')
    writePlaybook(join(child, '.agents', 'playbooks'), 'coding', '---\nname: coding\ndescription: cwd coding\n---\n')

    const fromList = listPlaybooks().find(p => p.name === 'coding')
    const fromLoad = loadPlaybook('coding')
    expect(fromList?.description).toBe('cwd coding')
    expect(fromLoad.description).toBe('cwd coding')
  })

  it('omits a malformed playbook instead of listing a second generic under its name', () => {
    writePlaybook(join(child, '.agents', 'playbooks'), 'broken', '---\nstages: [unclosed\n---\n')
    writePlaybook(join(child, '.agents', 'playbooks'), 'alpha', '---\nname: alpha\n---\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const names = listPlaybooks().map(p => p.name)
    warn.mockRestore()
    expect(names).toEqual(['alpha', 'generic'])
  })

  it('keeps a user-defined generic playbook when a malformed one sorts before it', () => {
    // Distinct text: gray-matter caches parses by input string, so reusing the
    // other test's malformed body would "parse" from cache on the second call.
    writePlaybook(join(child, '.agents', 'playbooks'), 'aaa-broken', '---\ntask_classes: [unclosed\n---\n')
    writePlaybook(join(child, '.agents', 'playbooks'), 'generic', '---\nname: generic\ndescription: custom generic\n---\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const list = listPlaybooks()
    warn.mockRestore()
    expect(list.map(p => p.name)).toEqual(['generic'])
    expect(list[0].description).toBe('custom generic')
  })

  it('includes generic even when no PLAYBOOK.md exists anywhere', () => {
    const names = listPlaybooks().map(p => p.name)
    expect(names).toEqual(['generic'])
    expect(loadPlaybook('generic').stages).toContain('verify')
  })
})
