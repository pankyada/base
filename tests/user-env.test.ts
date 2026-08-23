import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { loadUserEnv, userEnvPath, writeUserEnv } from '../src/config/user-env.js'

function home(): string {
  return mkdtempSync(join(tmpdir(), 'harness-user-env-'))
}

describe('user env', () => {
  it('loads valid entries without overwriting ambient values', () => {
    const dir = home()
    try {
      writeUserEnv('ANTHROPIC_API_KEY', 'from-file', dir)
      writeUserEnv('OTHER_KEY', '"quoted"', dir)
      const environment: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'ambient' }

      expect(loadUserEnv(dir, environment)).toEqual({ ANTHROPIC_API_KEY: 'from-file', OTHER_KEY: 'quoted' })
      expect(environment).toMatchObject({ ANTHROPIC_API_KEY: 'ambient', OTHER_KEY: 'quoted' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips malformed entries without exposing their values', () => {
    const dir = home()
    try {
      const path = userEnvPath(dir)
      writeUserEnv('GOOD', 'value', dir)
      writeFileSync(path, `${readFileSync(path, 'utf-8')}bad entry=secret-value\n# a comment\n`)
      const warn = vi.fn()

      expect(loadUserEnv(dir, {}, warn)).toEqual({ GOOD: 'value' })
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0][0]).not.toContain('secret-value')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes mode 0600 and preserves existing keys while updating one', () => {
    const dir = home()
    try {
      writeUserEnv('FIRST', 'one', dir)
      writeUserEnv('SECOND', 'two', dir)
      writeUserEnv('FIRST', 'updated', dir)

      expect(readFileSync(userEnvPath(dir), 'utf-8')).toBe('FIRST=updated\nSECOND=two\n')
      expect(statSync(userEnvPath(dir)).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
