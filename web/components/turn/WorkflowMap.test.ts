import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkflowMapSnapshot } from '../../lib/protocol'
import { WorkflowMap } from './WorkflowMap'

const snapshot: WorkflowMapSnapshot = {
  version: 1,
  scope: { run_id: 'r', session_id: 's', profile: 'coding' },
  revision: 5,
  availability: { state: 'partial', reason: 'retention_overflow' },
  retained_from_revision: 2,
  attempts: [
    { attempt_id: 'a', pass_id: 'p', playbook: 'coding', stage: 'build', attempt: 1, intensity: 2, tier: 'balanced', model: 'fixture-model', state: 'done', cost_usd: 0 },
    { attempt_id: 'b', pass_id: 'p', playbook: 'coding', stage: 'verify', attempt: 1, intensity: 1, tier: 'cheap', model: 'unknown-model', state: 'failed' },
    { attempt_id: 'x', pass_id: 'p', playbook: 'coding', stage: 'review', attempt: 1, intensity: 1, tier: 'cheap', model: 'fixture-model', state: 'done', explore: true },
  ],
  transitions: [
    { transition_id: 't1', to_attempt_id: 'a', kind: 'start' },
    { transition_id: 't2', from_attempt_id: 'a', to_attempt_id: 'b', kind: 'retry' },
    { transition_id: 't3', from_attempt_id: 'b', kind: 'terminal' },
  ],
  advice: [
    { advice_id: 'ad1', kind: 'route', mode: 'shadow', applied: false, summary: 'generic suggested' },
    { advice_id: 'ad2', kind: 'edge', mode: 'enforce', applied: false, action: 'continue' },
  ],
}

const render = (props: { defaultExpanded?: boolean } = {}) => renderToStaticMarkup(React.createElement(WorkflowMap, { snapshot, ...props }))

describe('WorkflowMap', () => {
  it('is a keyboard-operable disclosure with linked attempt cards and labeled branches', () => {
    const html = render()
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('Observed execution path')
    expect(html).toContain('Actual')
    expect(html).toContain('→')
    expect(html).toContain('retry')
    expect(html).toContain('Partial history')
    expect(html).toContain('Retained from revision 2')
    expect(html).toContain('coding · build · attempt 1')
    expect(html).toContain('coding · verify · attempt 1')
  })

  it('keeps advice separate, labels executed exploratory tier, and shows zero cost distinctly', () => {
    const html = render({ defaultExpanded: true })
    expect(html).toContain('open=""')
    expect(html).toContain('$0.00')
    expect(html).toContain('Cost unknown')
    expect(html).toContain('Shadow suggestion')
    expect(html).toContain('Not applied')
    expect(html).toContain('Exploratory tier · executed')
    expect(html).toContain('coding · review · attempt 1')
  })
})
