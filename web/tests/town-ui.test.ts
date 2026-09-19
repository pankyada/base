import { describe, expect, it, vi } from 'vitest'
import { applyTownSavedView, initialTownUIState, readTownLabelsVisible, TOWN_LABELS_KEY, townUIReducer, writeTownLabelsVisible, type TownUIState } from '../app/town/town-client'
import { TOWN_MODE_KEY } from '../app/town/town-world-model'

describe('Town canvas control state', () => {
  it('opens a group on hover or focus and closes transient groups on leave', () => {
    const open = townUIReducer(initialTownUIState, { type: 'group-enter', group: 'projects' })
    expect(open.rail).toEqual({ group: 'projects', pinned: false })
    expect(townUIReducer(open, { type: 'group-leave', group: 'projects' }).rail).toEqual({ group: null, pinned: false })
  })

  it('pins a group by click, keeps it open on leave, and Escape closes it', () => {
    const pinned = townUIReducer(initialTownUIState, { type: 'group-toggle', group: 'operations' })
    expect(pinned.rail).toEqual({ group: 'operations', pinned: true })
    expect(townUIReducer(pinned, { type: 'group-leave', group: 'operations' })).toEqual(pinned)
    expect(townUIReducer(pinned, { type: 'escape' }).rail).toEqual({ group: null, pinned: false })
  })

  it('keeps only one contextual card and Escape dismisses it when the rail is closed', () => {
    let state: TownUIState = townUIReducer(initialTownUIState, { type: 'group-toggle', group: 'projects' })
    state = townUIReducer(state, { type: 'select-card', selection: { type: 'project', id: 'repo-a' } })
    expect(state.rail).toEqual({ group: null, pinned: false })
    state = townUIReducer(state, { type: 'select-card', selection: { type: 'resident', id: 'agent-1' } })
    expect(state.card).toEqual({ type: 'resident', id: 'agent-1' })
    state = townUIReducer(state, { type: 'escape' })
    expect(state.card).toBeNull()
  })

  it('closes the expanded group before the contextual card on Escape', () => {
    let state = townUIReducer(initialTownUIState, { type: 'select-card', selection: { type: 'hall' } })
    state = townUIReducer(state, { type: 'group-toggle', group: 'view' })
    state = townUIReducer(state, { type: 'escape' })
    expect(state.rail.group).toBeNull()
    expect(state.card).toEqual({ type: 'hall' })
  })
})

describe('Town labels preference', () => {
  it('defaults labels off for a quiet map and persists visibility independently under its own route key', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    expect(readTownLabelsVisible(storage)).toBe(false)
    writeTownLabelsVisible(false, storage)
    expect(values.get(TOWN_LABELS_KEY)).toBe('false')
    expect(readTownLabelsVisible(storage)).toBe(false)
    writeTownLabelsVisible(true, storage)
    expect(readTownLabelsVisible(storage)).toBe(true)
    expect(values.has(TOWN_MODE_KEY)).toBe(false)
  })
})

describe('Town saved viewpoints', () => {
  it('applies both camera vectors and updates OrbitControls to publish the restored pose', () => {
    const position = { set: vi.fn() }
    const target = { set: vi.fn() }
    const update = vi.fn()
    const controls = { object: { position }, target, update } as unknown as Parameters<typeof applyTownSavedView>[0]
    const view = { position: [166.62, 54.07, 202.06] as [number, number, number], target: [-8.52, 1, 26.92] as [number, number, number] }

    applyTownSavedView(controls, view)

    expect(position.set).toHaveBeenCalledWith(...view.position)
    expect(target.set).toHaveBeenCalledWith(...view.target)
    expect(update).toHaveBeenCalledOnce()
  })
})
