import { describe, expect, it } from 'vitest'
import { observatoryReturnKey, parseObservatoryReturnView, readObservatoryReturnView, removeObservatoryReturnView, writeObservatoryReturnView, type ObservatoryReturnView } from '../app/town/town-portal-state'

const view: ObservatoryReturnView = { userId: 'user-a', profile: 'coding', position: [12, 20, 30], target: [1, 2, 3] }

describe('Town Observatory return view', () => {
  it('round trips a finite view under a key scoped to user and profile', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    writeObservatoryReturnView(storage, view)
    expect(observatoryReturnKey('user-a', 'coding')).not.toBe(observatoryReturnKey('user-a', 'research'))
    expect(readObservatoryReturnView(storage, 'user-a', 'coding')).toEqual(view)
    expect(readObservatoryReturnView(storage, 'user-b', 'coding')).toBeNull()
  })

  it('rejects malformed, stale-version, mismatched-scope, and unsafe poses', () => {
    expect(parseObservatoryReturnView('{', 'user-a', 'coding')).toBeNull()
    expect(parseObservatoryReturnView(JSON.stringify({ version: 2, ...view }), 'user-a', 'coding')).toBeNull()
    expect(parseObservatoryReturnView(JSON.stringify({ version: 1, ...view }), 'user-a', 'other')).toBeNull()
    expect(parseObservatoryReturnView(JSON.stringify({ version: 1, ...view, position: [0, Infinity, 1] }), 'user-a', 'coding')).toBeNull()
    expect(parseObservatoryReturnView(JSON.stringify({ version: 1, ...view, position: [1e9, 0, 0] }), 'user-a', 'coding')).toBeNull()
  })

  it('treats unavailable browser storage as an optional optimization', () => {
    const throwingStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(() => writeObservatoryReturnView(throwingStorage, view)).not.toThrow()
    expect(readObservatoryReturnView(throwingStorage, 'user-a', 'coding')).toBeNull()
  })

  it('consumes only the matching user/profile return pose', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
    writeObservatoryReturnView(storage, view)
    writeObservatoryReturnView(storage, { ...view, profile: 'research' })
    removeObservatoryReturnView(storage, 'user-a', 'coding')
    expect(readObservatoryReturnView(storage, 'user-a', 'coding')).toBeNull()
    expect(readObservatoryReturnView(storage, 'user-a', 'research')).toEqual({ ...view, profile: 'research' })
  })
})
