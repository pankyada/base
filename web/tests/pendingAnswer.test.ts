import { describe, expect, it } from 'vitest'
import { validatePendingAnswer } from '../lib/pendingAnswer'
describe('typed pending answers', () => {
  it('preserves text and validates selected option membership', () => {
    expect(validatePendingAnswer({ kind: 'text' }, 'hello')).toEqual({ ok: true, value: 'hello' })
    expect(validatePendingAnswer({ kind: 'select', options: ['red'] }, 'blue').ok).toBe(false)
    expect(validatePendingAnswer({ kind: 'select', options: ['red'] }, 'red')).toEqual({ ok: true, value: 'red' })
  })
  it('encodes multi-select arrays including comma-containing options without ambiguity', () => {
    expect(validatePendingAnswer({ kind: 'multi_select', options: ['a,b', 'c'] }, ['a,b', 'c'])).toEqual({ ok: true, value: '["a,b","c"]' })
    expect(validatePendingAnswer({ kind: 'multi_select', options: ['a'] }, ['a', 'a']).ok).toBe(false)
    expect(validatePendingAnswer({ kind: 'multi_select', options: ['a'] }, ['foreign']).ok).toBe(false)
  })
})
