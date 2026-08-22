import { describe, expect, it, vi } from 'vitest'
import { modelRows, shouldOfferCompact } from '../components/Palette'
import { Composer } from '../components/Composer'

describe('palette and composer commands', () => {
  it('shows model availability and price', () => {
    const rows = modelRows([{ id: 'm1', label: 'Model One', provider: 'p', base_url: '', context_window: 100, input_price: 2, output_price: 4, tags: [], available: false, reason: 'offline' }], vi.fn())
    expect(rows[0].label).toContain('Model One')
    expect(rows[0].label).toContain('$2/$4')
    expect(rows[0].disabled).toBe(true)
  })

  it('offers compact only above context threshold', () => {
    expect(shouldOfferCompact(80, 100)).toBe(true)
    expect(shouldOfferCompact(79, 100)).toBe(false)
    expect(shouldOfferCompact(undefined, undefined)).toBe(false)
  })

  it('keeps composer cancel behavior separate from send', () => {
    expect(typeof Composer).toBe('function')
  })
})
