import { useEffect, useState } from 'react'

export interface Toast { id?: string; level: 'info' | 'warn' | 'error'; message: string; detail?: string }
export function toastDuration(level: Toast['level']): number { return level === 'error' ? 9000 : level === 'warn' ? 6000 : 3500 }
export function appendToast(toasts: Toast[], toast: Toast): Toast[] {
  if (toasts.some(item => item.level === toast.level && item.message === toast.message)) return toasts
  return [...toasts, { ...toast, id: toast.id ?? `${toast.level}:${toast.message}` }]
}

const EMPTY_TOASTS: Toast[] = []

export function Toasts({ toasts = EMPTY_TOASTS }: { toasts?: Toast[] }) {
  const [visible, setVisible] = useState(toasts)
  useEffect(() => {
    setVisible(toasts)
    const timers = toasts.map(toast => window.setTimeout(() => setVisible(current => current.filter(item => item.id !== toast.id)), toastDuration(toast.level)))
    return () => timers.forEach(window.clearTimeout)
  }, [toasts])
  return <div className="toasts" aria-live="polite">{visible.map(toast => <div className={`toast toast--${toast.level}`} key={toast.id}>{toast.message}{toast.detail ? <small>{toast.detail}</small> : null}</div>)}</div>
}
