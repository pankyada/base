import React from 'react'
import type { WorkflowMapSnapshot, WorkflowMapTransition } from '../../lib/protocol'
import { attemptLabel, workflowMapSummary } from '../../lib/workflowMap'
import styles from './WorkflowMap.module.css'

function transitionLabel(kind: WorkflowMapTransition['kind']): string {
  return kind.replaceAll('_', ' ')
}

function AttemptNode({ attempt, label }: { attempt?: WorkflowMapSnapshot['attempts'][number]; label: string }) {
  if (!attempt) return <div className={`${styles.node} ${styles.nodeUnknown}`}><strong>{label}</strong><span>{label === 'Workflow entry' ? 'Start of observed path' : label === 'Workflow exit' ? 'End of observed path' : 'Attempt details unavailable'}</span></div>
  return <div className={styles.node}>
    <strong>{attemptLabel(attempt)}</strong>
    {attempt.explore ? <span className={styles.exploratory}>Exploratory tier · executed</span> : null}
    <span>{attempt.state} · I{attempt.intensity} · {attempt.tier} · {attempt.model}</span>
    <small>{attempt.cost_usd == null ? 'Cost unknown' : `$${attempt.cost_usd.toFixed(2)}`}</small>
  </div>
}

export function WorkflowMap({ snapshot, defaultExpanded = false, title = 'Workflow map' }: { snapshot: WorkflowMapSnapshot; defaultExpanded?: boolean; title?: string }) {
  const summary = workflowMapSummary(snapshot)
  const actual = snapshot.attempts
  const byId = new Map(actual.map(attempt => [attempt.attempt_id, attempt]))
  const transitions = snapshot.transitions
  const linkedAttemptIds = new Set(transitions.flatMap(transition => [transition.from_attempt_id, transition.to_attempt_id].filter((id): id is string => Boolean(id))))
  const looseAttempts = actual.filter(attempt => !linkedAttemptIds.has(attempt.attempt_id))
  const runStatus = snapshot.terminal?.replaceAll('_', ' ') ?? summary.status

  return <details className={styles.map} data-testid="workflow-map" data-availability={snapshot.availability.state} data-run-id={snapshot.scope.run_id} data-session-id={snapshot.scope.session_id} data-profile={snapshot.scope.profile} open={defaultExpanded}>
    <summary className={styles.summary}>
      <span className={styles.title}>{title}</span>
      <span className={styles.badge} data-state={snapshot.availability.state}>{runStatus}</span>
      <span className={styles.meta}>{summary.actualAttempts} observed {summary.actualAttempts === 1 ? 'attempt' : 'attempts'}</span>
      {snapshot.availability.state !== 'available' ? <span className={styles.availability}>{summary.availability}</span> : null}
      <span className={styles.toggle} aria-hidden="true">Details</span>
    </summary>
    <div className={styles.body}>
      <div className={styles.sectionHeading}><h3>Observed execution path</h3><span>Actual runner transitions</span></div>
      {transitions.length ? <ol className={styles.path} aria-label="Connected actual workflow execution path">
        {transitions.map(transition => <li className={styles.pathEdge} key={transition.transition_id} aria-label={`Actual transition: ${transitionLabel(transition.kind)}`}>
          <span className={styles.actualLabel}>Actual</span>
          <AttemptNode attempt={transition.from_attempt_id ? byId.get(transition.from_attempt_id) : undefined} label={transition.from_attempt_id ? 'Attempt not retained' : 'Workflow entry'} />
          <span className={styles.connector}>
            <span className={styles.branch}>{transitionLabel(transition.kind)}</span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </span>
          <AttemptNode attempt={transition.to_attempt_id ? byId.get(transition.to_attempt_id) : undefined} label={transition.to_attempt_id ? 'Attempt not retained' : 'Workflow exit'} />
        </li>)}
      </ol> : actual.length ? <p className={styles.empty}>Observed attempts are listed below; no transition links were retained.</p> : <p className={styles.empty}>{snapshot.availability.state === 'empty' ? 'No workflow steps were observed for this run.' : 'No complete actual attempts are available.'}</p>}

      {looseAttempts.length ? <section className={styles.loose} aria-label="Observed attempts without retained links">
        <h4>Observed attempts without retained links</h4>
        <ul>{looseAttempts.map(attempt => <li key={attempt.attempt_id}><AttemptNode attempt={attempt} label="" /></li>)}</ul>
      </section> : null}

      {snapshot.advice.length ? <section className={styles.advice} aria-label="Workflow advice">
        <div className={styles.sectionHeading}><h3>Advice</h3><span>Not an execution path</span></div>
        <ul>{snapshot.advice.map(advice => {
          const label = advice.mode === 'shadow' ? 'Shadow suggestion' : advice.applied ? 'Applied decision annotation' : 'Not applied'
          return <li key={advice.advice_id}><span className={styles.adviceLabel}>{label}</span><span>{advice.kind.replaceAll('_', ' ')}{advice.action ? ` · ${advice.action.replaceAll('_', ' ')}` : ''}{advice.summary ? ` · ${advice.summary}` : ''}</span></li>
        })}</ul>
      </section> : null}

      {snapshot.availability.state === 'partial' || snapshot.availability.state === 'unavailable' ? <p className={styles.notice} role="status">{summary.availability}{snapshot.retained_from_revision == null ? '' : ` · Retained from revision ${snapshot.retained_from_revision}`}</p> : null}
    </div>
  </details>
}
