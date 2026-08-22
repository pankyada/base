import { Plot, type SeriesData } from './Plot'
export function Scatter({ data }: { data: unknown }) { return <Plot data={data as SeriesData} mark="scatter" /> }
