import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Header } from '../../src/tui/components/header.js'

const defaultProps = {
  generating: false,
  narratorText: '',
  narratorSlow: false,
  waveBars: '▁▁▁▁▁▁▁▁',
  waveRate: 0,
  contextWindow: 0,
}

describe('Header', () => {
  it('renders profile name and session id', () => {
    const { lastFrame } = render(
      <Header
        {...defaultProps}
        profile="coding"
        sessionId="abc12345"
        tokensIn={0}
        tokensOut={0}
        costUsd={0}
        connected={true}
      />
    )
    expect(lastFrame()).toContain('coding')
    expect(lastFrame()).toContain('abc12345')
  })

  it('renders token counts and cost', () => {
    const { lastFrame } = render(
      <Header
        {...defaultProps}
        profile="coding"
        sessionId="abc12345"
        tokensIn={2431}
        tokensOut={184}
        costUsd={0.014}
        connected={true}
      />
    )
    expect(lastFrame()).toContain('2,431')
    expect(lastFrame()).toContain('184')
    expect(lastFrame()).toContain('$0.014')
  })

  it('shows disconnected indicator when not connected', () => {
    const { lastFrame } = render(
      <Header
        {...defaultProps}
        profile="coding"
        sessionId="abc12345"
        tokensIn={0}
        tokensOut={0}
        costUsd={0}
        connected={false}
      />
    )
    expect(lastFrame()).toContain('⚠')
  })

  it('shows narrator text while generating', () => {
    const { lastFrame } = render(
      <Header
        {...defaultProps}
        profile="coding"
        sessionId="abc12345"
        tokensIn={0}
        tokensOut={0}
        costUsd={0}
        connected={true}
        generating={true}
        narratorText="⚙ reading src/auth/token.ts · 0.4s"
      />
    )
    expect(lastFrame()).toContain('reading')
  })

  it('shows context bar when contextWindow is set', () => {
    const { lastFrame } = render(
      <Header
        {...defaultProps}
        profile="coding"
        sessionId="abc12345"
        tokensIn={20000}
        tokensOut={0}
        costUsd={0}
        connected={true}
        contextWindow={128000}
      />
    )
    expect(lastFrame()).toContain('ctx')
    expect(lastFrame()).toContain('128k')
  })
})
