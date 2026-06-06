export type PaletteMode = 'root' | 'project_switch' | 'project_new' | 'history' | 'history_all' | 'assign'

export interface RootCommand { id: string; label: string; group: string; mode: PaletteMode }

export const ROOT_COMMANDS: RootCommand[] = [
  { id: 'switch', label: 'Switch project…', group: 'PROJECT', mode: 'project_switch' },
  { id: 'newproj', label: 'New project…', group: 'PROJECT', mode: 'project_new' },
  { id: 'assign', label: 'Move session to project…', group: 'PROJECT', mode: 'assign' },
  { id: 'history', label: 'Browse history…', group: 'HISTORY', mode: 'history' },
  { id: 'history_all', label: 'Browse all history…', group: 'HISTORY', mode: 'history_all' },
]

// Esc behavior: from a submode, return to root; from root, signal close.
export function popMode(mode: PaletteMode): { mode: PaletteMode; close: boolean } {
  return mode === 'root' ? { mode: 'root', close: true } : { mode: 'root', close: false }
}
