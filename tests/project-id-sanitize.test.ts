import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import { projectPaths } from '../src/session/user-paths.js'

describe('projectPaths sanitizes projectId (path traversal safe)', () => {
  it('neutralizes traversal sequences in projectId', () => {
    const p = projectPaths('alice', '../../evil')
    // must stay within the user's projects dir — no '..' segments
    expect(p.recordFile.includes('..')).toBe(false)
    expect(p.memoryDir.includes('..')).toBe(false)
    expect(p.recordFile.startsWith(join(homedir(), '.harness', 'projects', 'alice'))).toBe(true)
  })

  it('leaves a normal generated id untouched', () => {
    const p = projectPaths('alice', 'a1b2c3d4')
    expect(p.recordFile).toBe(join(homedir(), '.harness', 'projects', 'alice', 'a1b2c3d4.json'))
  })

  it('leaves the literal inbox id untouched', () => {
    const p = projectPaths('alice', 'inbox')
    expect(p.recordFile).toBe(join(homedir(), '.harness', 'projects', 'alice', 'inbox.json'))
  })
})
