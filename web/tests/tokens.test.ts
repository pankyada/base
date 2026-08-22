import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8')
const block = (theme: 'dark' | 'light') => css.match(new RegExp(`:root\\[data-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
const names = (source: string) => [...source.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]).sort()

describe('design token parity', () => {
  it('defines equal token names in dark and light themes', () => {
    expect(names(block('dark'))).toEqual(names(block('light')))
  })

  it('defines chart, sequence, divider, stage, row, and gap ramps', () => {
    const all = names(block('dark'))
    for (const prefix of ['--series-', '--seq-', '--div-', '--st-', '--row-h-', '--gap-']) {
      expect(all.some(name => name.startsWith(prefix))).toBe(true)
    }
  })
})
