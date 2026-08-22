import { Plot, type SeriesData } from './Plot'
export function Area({ data }: { data: unknown }) { return <Plot data={data as SeriesData} mark="area" /> }
