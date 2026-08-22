interface Props { busy: boolean; profile: string; model?: string; onPalette: () => void }

export function Rail({ busy, profile, model, onPalette }: Props) {
  return (
    <aside className="rail" aria-label="Harness navigation">
      <button className="rail__brand" onClick={onPalette} aria-label="Open command palette">◆</button>
      <span className={`rail__status ${busy ? 'rail__status--busy' : ''}`} title={busy ? 'Working' : 'Ready'} />
      <span className="rail__profile" title={`${profile}${model ? ` · ${model}` : ''}`}>{profile.slice(0, 1).toUpperCase()}</span>
    </aside>
  )
}
