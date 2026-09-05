import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MissionCard } from '../components/ops/MissionCard'

describe('mission card', () => {
  it('renders criterion verification and receipt evidence', () => {
    const markup = renderToStaticMarkup(React.createElement(MissionCard, { mission: { id: 'm', status: 'needs_human', revision: 2, outcome: 'ship', criteria: [{ id: 'a', description: 'run command', state: 'verified' }, { id: 'b', description: 'operator check', state: 'needs_human' }] }, receipt: { accepted: false, unresolved: ['b'] } }))
    expect(markup).toContain('needs human'); expect(markup).toContain('1/2 criteria verified'); expect(markup).toContain('unresolved')
  })
})
