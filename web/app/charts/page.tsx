const linePoints = [
  { x: 'Mon', y: 24 }, { x: 'Tue', y: 38 }, { x: 'Wed', y: 31 }, { x: 'Thu', y: 52 }, { x: 'Fri', y: 47 }, { x: 'Sat', y: 63 }, { x: 'Sun', y: 58 },
]

const barData = [
  { label: 'Alpha', value: 78 }, { label: 'Beta', value: 34 }, { label: 'Gamma', value: 56 }, { label: 'Delta', value: 91 }, { label: 'Epsilon', value: 43 },
]

const donutData = [
  { label: 'Mobile', value: 44, color: 'var(--series-2)' },
  { label: 'Desktop', value: 33, color: 'var(--series-1)' },
  { label: 'Tablet', value: 23, color: 'var(--series-3)' },
]

const sparkData = [12, 18, 11, 25, 19, 27, 24, 31, 26, 35, 29, 41]

function LineChart() {
  const width = 640
  const height = 280
  const pad = 28
  const max = Math.max(...linePoints.map(point => point.y))
  const min = Math.min(...linePoints.map(point => point.y))
  const xStep = (width - pad * 2) / (linePoints.length - 1)
  const yScale = (value: number) => height - pad - ((value - min) / (max - min)) * (height - pad * 2)
  const d = linePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${pad + index * xStep} ${yScale(point.y)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weekly trend line chart" style={{ width: '100%', height: 'auto' }}>
      {[0, 1, 2, 3].map(step => (
        <line key={step} x1={pad} x2={width - pad} y1={pad + step * ((height - pad * 2) / 3)} y2={pad + step * ((height - pad * 2) / 3)} stroke="var(--border)" strokeDasharray="4 6" />
      ))}
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {linePoints.map((point, index) => (
        <g key={point.x}>
          <circle cx={pad + index * xStep} cy={yScale(point.y)} r="5" fill="var(--bg)" stroke="var(--series-1)" strokeWidth="3" />
          <text x={pad + index * xStep} y={height - 6} textAnchor="middle" fill="var(--dim)" fontSize="12">{point.x}</text>
        </g>
      ))}
    </svg>
  )
}

function BarChart() {
  return (
    <div className="bars">
      {barData.map(item => (
        <div key={item.label} className="bar-row">
          <span>{item.label}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${item.value}%` }} /></div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}

function DonutChart() {
  const size = 180
  const stroke = 22
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Traffic mix donut chart">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        {donutData.map(segment => {
          const dash = (segment.value / 100) * circumference
          const circle = <circle cx={size / 2} cy={size / 2} r={radius} stroke={segment.color} strokeWidth={stroke} fill="none" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          offset += dash
          return circle
        })}
      </svg>
      <div className="donut-legend">{donutData.map(item => <div key={item.label}><span style={{ background: item.color }} />{item.label} {item.value}%</div>)}</div>
    </div>
  )
}

function Sparkline() {
  const width = 320
  const height = 80
  const pad = 8
  const max = Math.max(...sparkData)
  const min = Math.min(...sparkData)
  const xStep = (width - pad * 2) / (sparkData.length - 1)
  const y = (value: number) => height - pad - ((value - min) / (max - min)) * (height - pad * 2)
  const d = sparkData.map((value, index) => `${index === 0 ? 'M' : 'L'} ${pad + index * xStep} ${y(value)}`).join(' ')
  return <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}><path d={d} fill="none" stroke="var(--series-2)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

import './styles.css'

export default function ChartsPage() {
  return (
    <main className="charts-page">
      <header className="charts-head">
        <div>
          <p>Fake data playground</p>
          <h1>Random charts</h1>
        </div>
        <span className="pill">All numbers are synthetic</span>
      </header>

      <section className="chart-grid">
        <article className="chart-card chart-card--wide">
          <div className="card-head"><h2>Weekly trend</h2><span>last 7 days</span></div>
          <LineChart />
        </article>

        <article className="chart-card">
          <div className="card-head"><h2>Traffic mix</h2><span>share</span></div>
          <DonutChart />
        </article>

        <article className="chart-card">
          <div className="card-head"><h2>Channel bars</h2><span>score</span></div>
          <BarChart />
        </article>

        <article className="chart-card chart-card--wide">
          <div className="card-head"><h2>Momentum sparkline</h2><span>12 points</span></div>
          <Sparkline />
        </article>
      </section>
    </main>
  )
}
