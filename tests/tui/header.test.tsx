import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Header } from '../../src/tui/components/header.js'

describe('Header', () => {
  it('renders profile name and session id', () => {
    const { lastFrame } = render(
      <Header
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
})
