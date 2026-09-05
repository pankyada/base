import { Shell } from '../../components/chrome/Shell'
import { Box } from '../../widgets/Box'
import { Correlation } from '../../widgets/Correlation'
import { Heatmap } from '../../widgets/Heatmap'

const heatmap = { columns: ['Jan', 'Feb', 'Mar'], rows: [{ label: 'alpha', values: [12, null, 19] }, { label: 'beta', values: [8, 14, 17] }] }
const box = { series: [{ key: 'latency', label: 'Latency', values: [12, 15, 18, 23, 31] }, { key: 'cost', label: 'Cost', values: [2, 3, 3, 4, 8] }] }
const correlation = { columns: ['latency', 'cost', 'quality'], matrix: [[1, .72, -.2], [.72, 1, .41], [-.2, .41, 1]] }

export default function WidgetsPage() {
  return <Shell><main className="route-page"><header><span className="eyebrow">R1 / VISUALS</span><h1>Fixture visual widgets</h1><p>SVG heatmap, box plot, and correlation matrix with explicit missing data.</p></header><section className="panel"><Heatmap data={heatmap} /></section><section className="panel"><Box data={box} /></section><section className="panel"><Correlation data={correlation} /></section></main></Shell>
}
