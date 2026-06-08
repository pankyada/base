import { describe, it, expect } from 'vitest'
import { ROOT_COMMANDS, popMode } from '../src/tui/palette-modes.js'

describe('tui palette modes', () => {
  it('exposes PROJECT and HISTORY commands mapped to modes', () => {
    expect(ROOT_COMMANDS.find(c => c.id === 'switch')?.mode).toBe('project_switch')
    expect(ROOT_COMMANDS.find(c => c.id === 'history')?.mode).toBe('history')
    expect(ROOT_COMMANDS.some(c => c.group === 'PROJECT')).toBe(true)
    expect(ROOT_COMMANDS.some(c => c.group === 'HISTORY')).toBe(true)
  })
  it('Esc from a submode returns to root without closing', () => {
    expect(popMode('history')).toEqual({ mode: 'root', close: false })
  })
  it('Esc from root closes', () => {
    expect(popMode('root')).toEqual({ mode: 'root', close: true })
  })
})
