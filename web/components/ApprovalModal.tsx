'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  error?: string
  toolName: string
  toolInput: unknown
  risk?: 'safe' | 'caution' | 'danger'
  reason?: string
  preview?: unknown
  onApprove: () => void
  onDeny: () => void
}

export function previewToolInput(toolName: string, input: unknown): string { const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}; if (toolName === 'Bash') return JSON.stringify({ command: value.command, cwd: value.cwd }, null, 2); if (toolName === 'Write' || toolName === 'Edit') return JSON.stringify({ path: value.path, old: value.old, content: value.content, new: value.new }, null, 2); if (toolName.toLowerCase().includes('http') || toolName.toLowerCase().includes('network')) return JSON.stringify({ host: value.host ?? value.url }, null, 2); return JSON.stringify(input, null, 2) }

export function ApprovalModal({ error, toolName, toolInput, risk, reason, preview, onApprove, onDeny }: Props) {
  const [dangerArmed, setDangerArmed] = useState(false)
  // Refs keep callbacks current without re-adding the listener on every render
  const onApproveRef = useRef(onApprove)
  const onDenyRef = useRef(onDeny)
  onApproveRef.current = onApprove
  onDenyRef.current = onDeny

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'y' || e.key === 'Enter') && risk !== 'danger') onApproveRef.current()
      if (e.key === 'n' || e.key === 'Escape') onDenyRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // empty — refs keep callbacks fresh without re-registering

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ width: '500px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '1rem' }}>
        <div style={{ color: 'var(--accent)', marginBottom: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Tool Approval Required</div>
        <div style={{ marginBottom: '0.5rem' }}>The agent wants to run: <span style={{ color: 'var(--info)' }}>{toolName}</span></div>
        <div style={{ color: risk === 'danger' ? 'var(--del)' : 'var(--warn)', marginBottom: '0.5rem' }}>{risk ?? 'caution'} · {reason ?? 'Review tool arguments before allowing.'}</div>
        <pre style={{ background: 'var(--bg)', padding: '0.5rem', border: '1px solid var(--border)', overflowX: 'auto', marginBottom: '1rem', color: 'var(--dim)' }}>
          {previewToolInput(toolName, toolInput)}
        </pre>
        {preview !== undefined ? <><div style={{ color: 'var(--info)', marginBottom: '0.25rem' }}>Side effect preview</div><pre style={{ background: 'var(--bg)', padding: '0.5rem', border: '1px solid var(--border)', overflowX: 'auto', marginBottom: '1rem', color: 'var(--dim)' }}>{JSON.stringify(preview, null, 2)}</pre></> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button onClick={onDeny} style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid var(--del)', color: 'var(--del)', cursor: 'pointer' }}>Deny (n)</button>
          <button onClick={() => { if (risk === 'danger' && !dangerArmed) setDangerArmed(true); else onApprove() }} style={{ padding: '0.5rem 1rem', background: risk === 'danger' ? 'var(--del)' : 'transparent', border: '1px solid var(--ok)', color: risk === 'danger' ? 'var(--bg)' : 'var(--ok)', cursor: 'pointer' }}>{risk === 'danger' && !dangerArmed ? 'Confirm danger' : 'Allow (y)'}</button>
        </div>
      </div>
    </div>
  )
}
