import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadAllCommands, loadCommandsFromDir, resolveCommandDirs } from '../src/skills/commands.js'

function command(root: string, filename: string, name: string, description: string, template: string) {
  writeFileSync(join(root, filename), `---\nname: ${name}\ndescription: ${description}\n---\n${template}`)
}

describe('custom command discovery', () => {
  it('loads frontmatter and body template, skipping malformed files', () => {
    const root = mkdtempSync(join(tmpdir(), 'commands-'))
    try {
      command(root, 'review.md', 'review', 'review changes', 'Review $ARGUMENTS')
      writeFileSync(join(root, 'bad.md'), '---\nname: missing-description\n---\nignored')
      writeFileSync(join(root, 'notes.txt'), 'ignored')
      const commands = loadCommandsFromDir(root)
      expect(commands).toHaveLength(1)
      expect(commands[0]).toMatchObject({ name: 'review', description: 'review changes', template: 'Review $ARGUMENTS' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses later command directories as more-specific overrides', () => {
    const globalDir = mkdtempSync(join(tmpdir(), 'commands-global-'))
    const localDir = mkdtempSync(join(tmpdir(), 'commands-local-'))
    try {
      command(globalDir, 'review.md', 'review', 'global', 'global $ARGUMENTS')
      command(localDir, 'review.md', 'review', 'local', 'local $ARGUMENTS')
      mkdirSync(join(localDir, 'unique'))
      command(localDir, 'ship.md', 'ship', 'ship it', 'Ship it')
      const commands = loadAllCommands([globalDir, localDir])
      expect(commands).toHaveLength(2)
      expect(commands.find(item => item.name === 'review')?.template).toBe('local $ARGUMENTS')
      expect(commands.find(item => item.name === 'ship')?.template).toBe('Ship it')
    } finally {
      rmSync(globalDir, { recursive: true, force: true })
      rmSync(localDir, { recursive: true, force: true })
    }
  })

  it('resolves command directories from the supplied session working directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'commands-session-cwd-'))
    try {
      const expected = join(cwd, '.agents', 'commands')
      expect(resolveCommandDirs(cwd)).toContain(expected)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
