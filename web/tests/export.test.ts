import { describe, expect, it } from 'vitest'
import { tableToCsv, sessionToHtml, canvasToPng, canvasToPdf, downloadPng, escapeHtml, serializeSvg } from '../lib/export'

describe('exports', () => {
  it('escapes CSV formulas, quotes, and creates self-contained HTML', () => {
    expect(tableToCsv(['value'], [['=1']])).toContain("'=1")
    expect(tableToCsv(['value'], [['a,b']])).toContain('"a,b"')
    expect(sessionToHtml('Title', '<p>Hi</p>')).not.toContain('http://')
    expect(sessionToHtml('Title', '<script>alert(1)</script>')).not.toContain('<script>')
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('exports canvas at two-times pixel ratio', () => {
    const calls: string[] = []
    const canvas = { width: 100, height: 50, getContext: () => ({ scale: (x: number, y: number) => calls.push(`${x}:${y}`) }), toDataURL: () => 'data:image/png;base64,x' }
    expect(canvasToPng(canvas as unknown as HTMLCanvasElement)).toBe('data:image/png;base64,x')
    expect(calls).toEqual(['2:2'])
  })

  it('serializes widget SVG for per-widget download', () => {
    const svg = { outerHTML: '<svg><rect /></svg>' } as SVGElement
    expect(serializeSvg(svg)).toContain('%3Csvg%3E')
  })

  it('creates a valid dependency-free PDF data URL', () => {
    const root = { innerText: 'Revenue\n42' } as HTMLElement
    const pdf = new TextDecoder().decode(Uint8Array.from(atob(canvasToPdf(root).split(',')[1]), character => character.charCodeAt(0)))
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('(Revenue) Tj')
    expect(pdf).toContain('%%EOF')
  })

  it('rejects PNG export when canvas has no SVG', async () => {
    expect(await downloadPng({ querySelector: () => null } as unknown as HTMLElement, 'empty')).toBe(false)
  })
})
