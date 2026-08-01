import { describe, expect, it } from 'vitest'
import { loadPlaybook } from '../src/workflow/playbook.js'
import { buildStageContext, validateArtifact, writeArtifact } from '../src/workflow/artifacts.js'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('workflow playbooks and artifacts', () => {
  it('loads coding contracts and generic fallback', () => {
    const coding = loadPlaybook('coding')
    expect(coding.stages).toContain('recon')
    expect(coding.contract('recon', 1).required_sections).toContain('Prior knowledge')
    expect(loadPlaybook('missing').name).toBe('generic')
  })

  it('validates required sections and never hands transcripts forward', () => {
    const contract = loadPlaybook('coding').contract('plan', 2)
    expect(validateArtifact('## Plan\n- x\n## Files\na.ts\n## Risks\nnone\n## Rollback\nreset', contract).ok).toBe(true)
    expect(validateArtifact('## Plan\n- x', contract).missing).toContain('Files')
    const context = buildStageContext('change x', [{ stage: 'recon', body: 'Prior knowledge: none' }], contract, 'graph node')
    expect(context).toContain('Prior knowledge: none')
    expect(context).toContain('graph node')
    expect(context).not.toContain('session.messages')
  })

  it('writes inspectable gray-matter artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workflow-artifact-'))
    const profile: any = { artifact_dir: dir }
    const session: any = { id: 'sess-1' }
    const path = writeArtifact(profile, session, 'build', '## Result\nokay', { intensity: 2, tier: 'balanced', model: 'm', contract_ok: true })
    expect(readFileSync(path, 'utf8')).toContain('contract_ok: true')
  })
})
