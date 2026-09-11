import { describe, expect, it, vi } from 'vitest'
import { Bulletin } from '../src/agents/bulletin.js'
import { postBoardMessage } from '../src/server/board-handler.js'
import { handleProjectMessage } from '../src/server/project-handlers.js'
import { createProject, getProject } from '../src/projects/store.js'
import { createSession, loadSession, saveSession } from '../src/session/store.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Core S7 board and project scope contracts', () => {
  it('posts operator board messages through Bulletin limits and provenance', () => {
    const bulletin = new Bulletin()
    const onAgentMessage = vi.fn()
    const post = postBoardMessage({ type: 'board_post', subject: 'handoff', body: 'fixture body', to: ['ag_child'] }, {
      bulletin, sessionId: 'session-a', profileName: 'alpha',
      agentFrame: { agent_id: 'root', agent_name: 'root', parent_agent_id: 'root', depth: 0, origin: 'operator', profile: 'alpha', session_id: 'session-a' },
      recipientAgentIds: new Set(['root', 'ag_child']), turnKey: 'root:session-a:turn-1',
      taintSources: ['untrusted fixture'], onAgentMessage,
    })
    expect(post).toMatchObject({ session_id: 'session-a', from_agent_id: 'root', from_agent_name: 'root', to: ['ag_child'], tainted: true })
    expect(onAgentMessage).toHaveBeenCalledWith(post)
    expect(bulletin.read('ag_child')).toEqual([post])
    expect(() => postBoardMessage({ type: 'board_post', subject: 'x', body: 'x', to: [1 as any] }, { bulletin, sessionId: 's', profileName: 'p', turnKey: 'root:s:turn-1' })).toThrow('recipients')
    expect(() => postBoardMessage({ type: 'board_post', subject: 1 as any, body: 'x' }, { bulletin, sessionId: 's', profileName: 'p', turnKey: 'root:s:turn-1' })).toThrow('subject')
    expect(() => postBoardMessage({ type: 'board_post', subject: 'x', body: 'x', to: ['other'] }, { bulletin, sessionId: 's', profileName: 'p', recipientAgentIds: new Set(['root']), turnKey: 'root:s:turn-1' })).toThrow('not active')
    expect(() => postBoardMessage({ type: 'board_post', subject: 'x', body: 'x', to: ['x'.repeat(257)] }, { bulletin, sessionId: 's', profileName: 'p', recipientAgentIds: new Set(['x'.repeat(257)]), turnKey: 'root:s:turn-1' })).toThrow('at most 256')
    expect(() => postBoardMessage({ type: 'board_post', subject: 'x', body: 'x', to: Array.from({ length: 33 }, (_, i) => `ag_${i}`) }, { bulletin, sessionId: 's', profileName: 'p', recipientAgentIds: new Set(Array.from({ length: 33 }, (_, i) => `ag_${i}`)), turnKey: 'root:s:turn-1' })).toThrow('at most 32')
    for (let i = 0; i < 4; i++) postBoardMessage({ type: 'board_post', subject: `more-${i}`, body: 'x' }, { bulletin, sessionId: 'session-a', profileName: 'alpha', recipientAgentIds: new Set(['root', 'ag_child']), turnKey: 'root:session-a:turn-2' })
    expect(() => postBoardMessage({ type: 'board_post', subject: 'six', body: 'x' }, { bulletin, sessionId: 'session-a', profileName: 'alpha', recipientAgentIds: new Set(['root', 'ag_child']), turnKey: 'root:session-a:turn-2' })).not.toThrow()
    expect(() => postBoardMessage({ type: 'board_post', subject: 'seven', body: 'x' }, { bulletin, sessionId: 'session-a', profileName: 'alpha', recipientAgentIds: new Set(['root', 'ag_child']), turnKey: 'root:session-a:turn-2' })).toThrow('5 posts already')
  })

  it('rejects assignment to a project outside the caller user scope without mutating session', () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-s7-project-scope-'))
    const previousHome = process.env.HOME
    process.env.HOME = home
    try {
      const aliceProject = createProject('alice', 'Alice only')
      const bobSession = createSession('beta', 'bob')
      saveSession(bobSession)
      const response = handleProjectMessage({ type: 'project_assign', sessionId: bobSession.id, projectId: aliceProject.id }, 'bob')
      expect(response).toEqual({ type: 'error', message: 'project not found' })
      expect(getProject('alice', aliceProject.id)).toBeTruthy()
      expect(loadSession('bob', bobSession.id)?.project).toBe('inbox')
    } finally {
      process.env.HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('bounds ephemeral turn-key rate history while enforcing five posts for the current key', () => {
    const bulletin = new Bulletin()
    for (let i = 0; i < 300; i++) {
      bulletin.post({ session_id: 's', from_agent_id: 'root', from_agent_name: 'root', to: 'all', kind: 'post', subject: `post-${i}`, body: 'x', tainted: false }, `turn-${i}`)
    }
    expect((bulletin as any).perTurn.size).toBeLessThanOrEqual(256)
    for (let i = 0; i < 5; i++) bulletin.post({ session_id: 's', from_agent_id: 'root', from_agent_name: 'root', to: 'all', kind: 'post', subject: `current-${i}`, body: 'x', tainted: false }, 'current-turn')
    expect(() => bulletin.post({ session_id: 's', from_agent_id: 'root', from_agent_name: 'root', to: 'all', kind: 'post', subject: 'current-six', body: 'x', tainted: false }, 'current-turn')).toThrow('5 posts already')
  })
})
