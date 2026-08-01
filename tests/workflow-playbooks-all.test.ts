import { describe, expect, it } from 'vitest'
import { loadPlaybook } from '../src/workflow/playbook.js'

describe('shipped workflow playbooks', () => {
  it('gives every profile family a meaningful stage contract', () => {
    for (const name of ['coding', 'research', 'data', 'writing', 'security']) {
      const playbook = loadPlaybook(name)
      expect(playbook.stages).toContain('verify')
      for (const stage of playbook.stages) expect(playbook.contract(stage, 1).required_sections.length).toBeGreaterThan(0)
      expect(playbook.contract('verify', 1).required_sections.length).toBeGreaterThan(0)
    }
  })
})
