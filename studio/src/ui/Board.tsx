import type { BulletinPostWire, ChallengeWire } from '../protocol.js'

export function Board({ posts, challenges = [], onChallengeAnswer }: { posts: BulletinPostWire[]; challenges?: ChallengeWire[]; onChallengeAnswer?: (challengeId: string, unresolved: boolean) => void }) {
  return <section className="panel board">
    <div className="panel-kicker">Shared board</div><h2>What team shared</h2>
    {challenges.length ? <div className="challenge-queue" aria-label="Challenge queue"><strong>Verification challenges</strong>{challenges.slice(0, 4).map(challenge => <article className={`challenge ${challenge.state}`} key={challenge.id}><span>{challenge.state} · round {challenge.round}</span><p>{challenge.question}</p><small>{challenge.evidence_count} receipt refs · {challenge.resolution_evidence_count} resolution refs</small>{challenge.state === 'open' && onChallengeAnswer ? <div><button onClick={() => onChallengeAnswer(challenge.id, false)}>Resolve with evidence</button><button className="quiet" onClick={() => onChallengeAnswer(challenge.id, true)}>Leave unresolved</button></div> : null}</article>)}</div> : null}
    {posts.length ? posts.slice(0, 4).map(post => <article className={post.tainted ? 'post tainted' : 'post'} key={post.id}><strong>{post.subject}</strong><span>{post.from_agent_name}</span><p>{post.body_preview}</p></article>) : <p className="empty">Notes land here. Full receipts stay in mission truth.</p>}
  </section>
}
