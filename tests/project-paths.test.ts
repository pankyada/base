import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import { projectPaths } from '../src/session/user-paths.js'

describe('projectPaths', () => {
  it('composes record file and memory dir under ~/.harness/projects', () => {
    const p = projectPaths('Pankaj!', 'inbox')
    expect(p.recordFile).toBe(join(homedir(), '.harness', 'projects', 'pankaj-', 'inbox.json'))
    expect(p.memoryDir).toBe(join(homedir(), '.harness', 'projects', 'pankaj-', 'inbox', 'memory'))
  })
})
