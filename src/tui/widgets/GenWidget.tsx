import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'
import type { ArtifactWidget } from '../../types.js'

// Mock implementations for all GenUI widgets since Ink UI widgets are complex and out of scope for a basic implementation.
export function Metrics({ data }: { data: unknown }) { return <Text>Metrics Widget</Text> }
export function BarChart({ data }: { data: unknown }) { return <Text>BarChart Widget</Text> }
export function LineChart({ data }: { data: unknown }) { return <Text>LineChart Widget</Text> }
export function DataTable({ data }: { data: unknown }) { return <Text>DataTable Widget</Text> }
export function FileTree({ data }: { data: unknown }) { return <Text>FileTree Widget</Text> }
export function Diff({ data }: { data: unknown }) { return <Text>Diff Widget</Text> }
export function TermOut({ data }: { data: unknown }) { return <Text>TermOut Widget</Text> }
export function Doc({ data }: { data: unknown }) { return <Text>Doc Widget</Text> }
export function Research({ data }: { data: unknown }) { return <Text>Research Widget</Text> }

interface Props {
  artifact: ArtifactWidget
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
    default: return <Text color={C.del}>Unknown widget kind: {artifact.kind}</Text>
  }
}
