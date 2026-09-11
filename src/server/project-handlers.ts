import { ClientMessage, ServerMessage } from '../types.js'
import { createProject, getProject, listProjects, ensureInbox } from '../projects/store.js'
import { listSessionSummaries, assignSession } from '../session/store.js'

// Returns a ServerMessage to send back, or null if the message is not a project/history op.
export function handleProjectMessage(msg: ClientMessage, user: string): ServerMessage | null {
  switch (msg.type) {
    case 'project_create': {
      const project = createProject(user, msg.name, msg.description)
      return { type: 'project_created', project }
    }
    case 'project_list': {
      ensureInbox(user)
      return { type: 'projects', projects: listProjects(user) }
    }
    case 'project_assign': {
      if (!getProject(user, msg.projectId)) return { type: 'error', message: 'project not found' }
      assignSession(user, msg.sessionId, msg.projectId)
      return { type: 'sessions', sessions: listSessionSummaries(user) }
    }
    case 'session_list': {
      return { type: 'sessions', sessions: listSessionSummaries(user, msg.projectId) }
    }
    default:
      return null
  }
}
