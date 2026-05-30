import { Artifact } from '../lib/types.js'

// Simple placeholder components for all widgets to pass typechecking first
export function Metrics({ data }: { data: unknown }) { return <div>Metrics Widget</div> }
export function BarChart({ data }: { data: unknown }) { return <div>BarChart Widget</div> }
export function LineChart({ data }: { data: unknown }) { return <div>LineChart Widget</div> }
export function DataTable({ data }: { data: unknown }) { return <div>DataTable Widget</div> }
export function FileTree({ data }: { data: unknown }) { return <div>FileTree Widget</div> }
export function Diff({ data }: { data: unknown }) { return <div>Diff Widget</div> }
export function TermOut({ data }: { data: unknown }) { return <div>TermOut Widget</div> }
export function Doc({ data }: { data: unknown }) { return <div>Doc Widget</div> }
export function Research({ data }: { data: unknown }) { return <div>Research Widget</div> }

interface Props {
  artifact: Artifact
}

export function GenWidget({ artifact }: Props) {
  switch (artifact.kind) {
    case 'metrics': return <Metrics data={artifact.data} />
    case 'bar': return <BarChart data={artifact.data} />
    case 'line': return <LineChart data={artifact.data} />
    case 'table': return <DataTable data={artifact.data} />
    case 'filetree': return <FileTree data={artifact.data} />
    case 'diff': return <Diff data={artifact.data} />
    case 'terminal': return <TermOut data={artifact.data} />
    case 'doc': return <Doc data={artifact.data} />
    case 'research': return <Research data={artifact.data} />
    default: return <div style={{ color: 'var(--del)' }}>Unknown widget kind: {artifact.kind}</div>
  }
}
