'use client'
import { useEffect, useState } from 'react'
import { validatePendingAnswer } from '../../lib/pendingAnswer'

export interface InboxItem { id: string; prompt: string; expires_at: string; kind?: 'text' | 'select' | 'multi_select'; options?: string[] }
export interface AnswerState { busy?: boolean; error?: string }
export function pendingLabel(expiresAt: string, now = Date.now()): string { const remaining = Math.ceil((new Date(expiresAt).getTime() - now) / 1000); return remaining <= 0 ? 'expired' : remaining + 's remaining' }
function Answer({ item, now, state, onAnswer }: { item: InboxItem; now: number; state?: AnswerState; onAnswer?: (id: string, value: string) => void }) {
  const [text, setText] = useState('')
  const [values, setValues] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const kind = item.kind ?? 'text'
  const disabled = state?.busy || new Date(item.expires_at).getTime() <= now
  const submit = () => {
    if (disabled) return
    const result = validatePendingAnswer({ kind, options: item.options }, kind === 'multi_select' ? values : text)
    if (!result.ok) { setError(result.error); return }
    setError(undefined); onAnswer?.(item.id, result.value)
  }
  return <article><strong>{item.prompt}</strong><span>{pendingLabel(item.expires_at, now)}</span>
    {kind === 'text' ? <input aria-label={'Answer ' + item.id} value={text} disabled={disabled} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit() }} /> : kind === 'select' ?
      <select aria-label={'Answer ' + item.id} value={text} disabled={disabled} onChange={event => setText(event.target.value)}><option value="" disabled>Choose an option</option>{item.options?.map(option => <option key={option} value={option}>{option}</option>)}</select> :
      <fieldset disabled={disabled}><legend>Answer {item.id}</legend>{item.options?.map(option => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={event => setValues(current => event.target.checked ? [...current, option] : current.filter(value => value !== option))} />{option}</label>)}</fieldset>}
    <button type="button" disabled={disabled} onClick={submit}>{state?.busy ? 'Waiting for confirmation…' : 'Send answer'}</button>
    {error || state?.error ? <p role="alert">{error ?? state?.error}</p> : null}
  </article>
}
export function Inbox({ items = [], answers = {}, onAnswer }: { items?: InboxItem[]; answers?: Record<string, AnswerState>; onAnswer?: (id: string, value: string) => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  return <section className="inbox"><h2>Inbox</h2>{items.length === 0 ? <p>Nothing waiting for input.</p> : items.map(item => <Answer key={item.id} item={item} now={now} state={answers[item.id]} onAnswer={onAnswer} />)}</section>
}
