import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Message } from '../../src/tui/components/message.js'

describe('Message — user', () => {
  it('renders with you: prefix', () => {
    const { lastFrame } = render(
      <Message msg={{ role: 'user', content: 'fix the auth bug', id: '1' }} onSend={vi.fn()} />
    )
    expect(lastFrame()).toContain('you:')
    expect(lastFrame()).toContain('fix the auth bug')
  })
})

describe('Message — assistant', () => {
  it('renders assistant text', () => {
    const { lastFrame } = render(
      <Message
        msg={{ role: 'assistant', content: 'Sure, let me look.', streaming: false, id: '2' }}
        onSend={vi.fn()}
      />
    )
    expect(lastFrame()).toContain('Sure, let me look.')
  })
})

describe('Message — tool-call', () => {
  it('renders tool name and running status', () => {
    const { lastFrame } = render(
      <Message
        msg={{ role: 'tool-call', name: 'Read', input: { path: 'src/auth.ts' }, status: 'running', id: '3' }}
        onSend={vi.fn()}
      />
    )
    expect(lastFrame()).toContain('⚙')
    expect(lastFrame()).toContain('Read')
  })

  it('renders duration when done', () => {
    const { lastFrame } = render(
      <Message
        msg={{ role: 'tool-call', name: 'Read', input: {}, status: 'ok', duration_ms: 34, id: '4' }}
        onSend={vi.fn()}
      />
    )
    expect(lastFrame()).toContain('34ms')
  })
})

describe('Message — tool-prompt', () => {
  it('renders allow prompt with tool name', () => {
    const { lastFrame } = render(
      <Message
        msg={{ role: 'tool-prompt', name: 'Bash', input: { command: 'ls' }, id: '5', pending: true }}
        onSend={vi.fn()}
      />
    )
    expect(lastFrame()).toContain('⚠')
    expect(lastFrame()).toContain('Bash')
    expect(lastFrame()).toContain('[y/N]')
  })
})
