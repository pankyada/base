import { randomUUID } from 'node:crypto'

export type BulletinKind = 'post' | 'ask' | 'answer' | 'handoff' | 'standup'
export interface BulletinPost {
  id: string
  seq: number
  session_id: string
  from_agent_id: string
  from_agent_name: string
  to: 'all' | string[]
  kind: BulletinKind
  subject: string
  body: string
  artifact_ids?: string[]
  tainted: boolean
  taint_sources?: string[]
  ts: number
}

export class Bulletin {
  private posts: BulletinPost[] = []
  private seq = 0
  private perTurn = new Map<string, number>()

  post(input: Omit<BulletinPost, 'id' | 'seq' | 'ts'>, turnKey: string): BulletinPost {
    const subject = input.subject.trim()
    const body = input.body.trim()
    if (!subject) throw new Error('board post refused: subject is required')
    if (subject.length > 120) throw new Error(`board post refused: subject is ${subject.length} chars; maximum is 120`)
    if (!body) throw new Error('board post refused: body is required')
    if (Buffer.byteLength(body, 'utf8') > 2048) throw new Error(`board post refused: body is ${Buffer.byteLength(body, 'utf8')} bytes; maximum is 2048`)
    const count = this.perTurn.get(turnKey) ?? 0
    if (count >= 5) throw new Error('board post refused: 5 posts already made this turn; maximum is 5')
    this.perTurn.set(turnKey, count + 1)
    const post: BulletinPost = { ...input, id: randomUUID(), seq: ++this.seq, subject, body, ts: Date.now() }
    this.posts.push(post)
    if (this.posts.length > 200) this.posts.shift()
    return post
  }

  read(agentId: string, options: { sinceSeq?: number; mineOnly?: boolean; subjectContains?: string; limit?: number } = {}): BulletinPost[] {
    const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)))
    const needle = options.subjectContains?.toLowerCase()
    return this.posts.filter(post => post.seq > (options.sinceSeq ?? 0))
      .filter(post => !options.mineOnly || post.from_agent_id === agentId)
      .filter(post => post.to === 'all' || post.to.includes(agentId))
      .filter(post => !needle || post.subject.toLowerCase().includes(needle))
      .slice(-limit)
  }
}
