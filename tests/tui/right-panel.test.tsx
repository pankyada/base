import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { RightPanel } from '../../src/tui/components/right-panel.js'

describe('RightPanel', () => {
  it('renders TOOLS section header', () => {
    const { lastFrame } = render(
      <RightPanel
        tools={[]}
        memoryKeys={[]}
        tokensIn={0}
        tokensOut={0}
        costUsd={0}
      />
    )
    expect(lastFrame()).toContain('TOOLS')
  })

  it('renders tool entries', () => {
    const { lastFrame } = render(
      <RightPanel
        tools={[{ name: 'Read', status: 'ok', duration_ms: 12, ts: Date.now() }]}
        memoryKeys={[]}
        tokensIn={0}
        tokensOut={0}
        costUsd={0}
      />
    )
    expect(lastFrame()).toContain('Read')
    expect(lastFrame()).toContain('12ms')
  })

  it('renders memory keys', () => {
    const { lastFrame } = render(
      <RightPanel
        tools={[]}
        memoryKeys={[{ key: 'project-context', isNew: false }]}
        tokensIn={0}
        tokensOut={0}
        costUsd={0}
      />
    )
    expect(lastFrame()).toContain('MEMORY')
    expect(lastFrame()).toContain('project-context')
  })

  it('renders new memory key differently', () => {
    const { lastFrame } = render(
      <RightPanel
        tools={[]}
        memoryKeys={[{ key: 'api-patterns', isNew: true }]}
        tokensIn={0}
        tokensOut={0}
        costUsd={0}
      />
    )
    expect(lastFrame()).toContain('+ api-patterns')
  })

  it('renders stats', () => {
    const { lastFrame } = render(
      <RightPanel
        tools={[]}
        memoryKeys={[]}
        tokensIn={2431}
        tokensOut={184}
        costUsd={0.014}
      />
    )
    expect(lastFrame()).toContain('STATS')
    expect(lastFrame()).toContain('2,431')
    expect(lastFrame()).toContain('$0.014')
  })

  it('renders keybinding hints', () => {
    const { lastFrame } = render(
      <RightPanel tools={[]} memoryKeys={[]} tokensIn={0} tokensOut={0} costUsd={0} />
    )
    expect(lastFrame()).toContain('^C')
    expect(lastFrame()).toContain('^L')
  })
})
