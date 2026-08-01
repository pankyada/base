import { describe, expect, it } from 'vitest'
import { generalizationFromReview } from '../src/workflow/knowledge.js'
import { loadPlaybook } from '../src/workflow/playbook.js'
import { validateArtifact } from '../src/workflow/artifacts.js'

describe('workflow generalization probe', () => {
  it('requires the review probe at higher intensity and emits followup edges only on yes', () => {
    const contract = loadPlaybook('coding').contract('review', 2)
    expect(validateArtifact('## Review\nokay\n## Findings\nnone', contract).ok).toBe(false)
    const yes = generalizationFromReview('## Review\nokay\n## Findings\nnone\n## Generalization\nYes, apply to research.')
    expect(yes.nodes[0].type).toBe('Followup')
    expect(yes.edges[0].relation).toBe('generalizes_to')
    expect(generalizationFromReview('## Generalization\nNo.').nodes).toHaveLength(0)
  })
})
