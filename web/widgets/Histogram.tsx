import { Plot, type SeriesData } from './Plot'
export function Histogram({ data }: { data: unknown }) { return <Plot data={data as SeriesData} mark="bar" /> }
