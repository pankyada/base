import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { RightPanel } from '../../src/tui/components/right-panel.js'

const defaultProps = {
  tools: [] as any[],
  memoryKeys: [] as any[],
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  activeTab: 'tools' as const,
  sessionStart: 0,
}

describe('RightPanel', () => {
  it('renders TOOLS tab header', () => {
    const { lastFrame } = render(<RightPanel {...defaultProps} />)
    expect(lastFrame()).toContain('TOOLS')
  })

  it('renders tool entries in tools tab', () => {
    const { lastFrame } = render(
      <RightPanel
        {...defaultProps}
        tools={[{ name: 'Read', status: 'ok', duration_ms: 12, ts: Date.now() }]}
      />
    )
    expect(lastFrame()).toContain('Read')
    expect(lastFrame()).toContain('12ms')
  })

  it('renders memory keys in memory tab', () => {
    const { lastFrame } = render(
      <RightPanel
        {...defaultProps}
        activeTab="memory"
        memoryKeys={[{ key: 'project-context', isNew: false }]}
      />
    )
    expect(lastFrame()).toContain('project-context')
  })

  it('renders new memory key with isNew indicator', () => {
    const { lastFrame } = render(
      <RightPanel
        {...defaultProps}
        activeTab="memory"
        memoryKeys={[{ key: 'api-patterns', isNew: true }]}
      />
    )
    expect(lastFrame()).toContain('api-patterns')
  })

  it('renders stats tab', () => {
    const { lastFrame } = render(
      <RightPanel
        {...defaultProps}
        activeTab="stats"
        tokensIn={2431}
        tokensOut={184}
        costUsd={0.014}
      />
    )
    expect(lastFrame()).toContain('2,431')
    expect(lastFrame()).toContain('0.0140')
  })

  it('renders keybinding hints', () => {
    const { lastFrame } = render(<RightPanel {...defaultProps} />)
    expect(lastFrame()).toContain('^C')
    expect(lastFrame()).toContain('^L')
  })

  it('renders tab bar with all three tabs', () => {
    const { lastFrame } = render(<RightPanel {...defaultProps} />)
    expect(lastFrame()).toContain('MEMORY')
    expect(lastFrame()).toContain('STATS')
  })
})
