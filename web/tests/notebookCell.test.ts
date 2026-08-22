import { describe, expect, it } from 'vitest'
import { fileMime, truncateOutput } from '../components/data/NotebookCell'

describe('notebook cells', () => {
  it('recognizes image files and truncates runaway output', () => {
    expect(fileMime('plot.png')).toBe('image/png')
    expect(fileMime('results.csv')).toBeNull()
    expect(truncateOutput('a'.repeat(20), 10)).toEqual({ text: 'aaaaaaaaaa', truncated: true })
  })
})
