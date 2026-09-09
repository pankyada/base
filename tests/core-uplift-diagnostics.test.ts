import { describe, expect, it } from 'vitest'
import { promptAssemblyDiagnostics } from '../src/context/diagnostics.js'

describe('Core safe prompt diagnostics', () => {
  it('reports source ordering and bounded sizes without prompt content', () => {
    const diagnostics = promptAssemblyDiagnostics({ profile: 'secret profile text', project: 'project', skills: 'skills', memory: 'private memory' })
    expect(diagnostics.ordering).toEqual(['profile', 'project', 'skills', 'memory'])
    expect(diagnostics.sizes).toMatchObject({ profile: 19, project: 7, skills: 6, memory: 14, total: 46 })
    expect(JSON.stringify(diagnostics)).not.toContain('secret profile text')
    expect(JSON.stringify(diagnostics)).not.toContain('private memory')
  })
})
