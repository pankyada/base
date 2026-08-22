import { Plot, type SeriesData } from './Plot'
export function Line({ data }: { data: unknown }) { return <Plot data={data as SeriesData} mark="line" /> }
