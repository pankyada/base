import { describe, it, expect } from 'vitest'
import { projectPaths } from '../src/session/user-paths.js'
import { harnessStatePath } from '../src/config/state-paths.js'

describe('projectPaths', () => {
  it('composes record file and memory dir under ~/.harness/projects', () => {
    const p = projectPaths('Pankaj!', 'inbox')
    expect(p.recordFile).toBe(harnessStatePath('projects', 'pankaj-', 'inbox.json'))
    expect(p.memoryDir).toBe(harnessStatePath('projects', 'pankaj-', 'inbox', 'memory'))
  })
})
