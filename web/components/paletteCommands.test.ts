import { describe, it, expect } from 'vitest'
import { ROOT_COMMANDS } from './Palette'

describe('palette root commands', () => {
  it('exposes PROJECT and HISTORY commands mapped to modes', () => {
    expect(ROOT_COMMANDS.find(c => c.id === 'switch')?.mode).toBe('project_switch')
    expect(ROOT_COMMANDS.find(c => c.id === 'newproj')?.mode).toBe('project_new')
    expect(ROOT_COMMANDS.find(c => c.id === 'assign')?.mode).toBe('assign')
    expect(ROOT_COMMANDS.find(c => c.id === 'history')?.mode).toBe('history')
    expect(ROOT_COMMANDS.find(c => c.id === 'history_all')?.mode).toBe('history_all')
    expect(ROOT_COMMANDS.some(c => c.group === 'PROJECT')).toBe(true)
    expect(ROOT_COMMANDS.some(c => c.group === 'HISTORY')).toBe(true)
  })
})
