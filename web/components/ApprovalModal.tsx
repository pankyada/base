'use client'
import { useEffect, useRef } from 'react'

interface Props {
  toolName: string
  toolInput: unknown
  onApprove: () => void
  onDeny: () => void
}

export function ApprovalModal({ toolName, toolInput, onApprove, onDeny }: Props) {
  // Refs keep callbacks current without re-adding the listener on every render
  const onApproveRef = useRef(onApprove)
  const onDenyRef = useRef(onDeny)
  onApproveRef.current = onApprove
  onDenyRef.current = onDeny

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Enter') onApproveRef.current()
      if (e.key === 'n' || e.key === 'Escape') onDenyRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // empty — refs keep callbacks fresh without re-registering

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ width: '500px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '1rem' }}>
        <div style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '1rem' }}>Tool Approval Required</div>
        <div style={{ marginBottom: '0.5rem' }}>The agent wants to run: <span style={{ color: 'var(--info)' }}>{toolName}</span></div>
        <pre style={{ background: 'var(--bg)', padding: '0.5rem', border: '1px solid var(--border)', overflowX: 'auto', marginBottom: '1rem', color: 'var(--dim)' }}>
          {JSON.stringify(toolInput, null, 2)}
        </pre>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button onClick={onDeny} style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid var(--del)', color: 'var(--del)', cursor: 'pointer' }}>Deny (n)</button>
          <button onClick={onApprove} style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid var(--ok)', color: 'var(--ok)', cursor: 'pointer' }}>Allow (y)</button>
        </div>
      </div>
    </div>
  )
}
