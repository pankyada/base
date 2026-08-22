const groups = [
  ['series', 8], ['seq', 6], ['gap', 6],
]

export default function TokensFixture() {
  return (
    <main style={{ padding: 32, background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }}>
      <h1>Design token ramps</h1>
      {groups.map(([name, count]) => (
        <section key={name} style={{ marginBlock: 24 }}>
          <h2>{name}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Array.from({ length: count as number }, (_, index) => (
              <div key={index} style={{ width: 72, height: 48, padding: 8, background: `var(--${name}-${name === 'seq' ? index : index + 1})`, border: '1px solid var(--border)' }}>
                {name}-{name === 'seq' ? index : index + 1}
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
