import { useEffect } from 'react'

interface Props {
  open: boolean
  theme: string
  setTheme: (v: string) => void
  palette: string
  setPalette: (v: string) => void
  density: string
  setDensity: (v: string) => void
  userId: string
  setUserId: (v: string) => void
}

export function Tweaks({ open, theme, setTheme, palette, setPalette, density, setDensity, userId, setUserId }: Props) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-palette', palette)
    document.documentElement.setAttribute('data-density', density)
  }, [theme, palette, density])

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: '300px',
      background: 'var(--panel)', borderLeft: '1px solid var(--border)',
      padding: '1rem', zIndex: 50,
      transform: open ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.2s ease'
    }}>
      <h3 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Tweaks</h3>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ color: 'var(--dim)', marginBottom: '0.5rem' }}>Session identity (scope only)</div>
        <input value={userId} onChange={event => { setUserId(event.target.value); localStorage.setItem('harness-user-id', event.target.value) }} style={{ width: '100%', padding: '0.5rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }} />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ color: 'var(--dim)', marginBottom: '0.5rem' }}>Theme</div>
        <select value={theme} onChange={e => setTheme(e.target.value)} style={{ width: '100%', padding: '0.5rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ color: 'var(--dim)', marginBottom: '0.5rem' }}>Palette</div>
        <select value={palette} onChange={e => setPalette(e.target.value)} style={{ width: '100%', padding: '0.5rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
          <option value="amber">Amber</option>
          <option value="flux">Flux</option>
          <option value="ember">Ember</option>
        </select>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ color: 'var(--dim)', marginBottom: '0.5rem' }}>Density</div>
        <select value={density} onChange={e => setDensity(e.target.value)} style={{ width: '100%', padding: '0.5rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
          <option value="regular">Regular</option>
          <option value="compact">Compact</option>
        </select>
      </div>
    </div>
  )
}
