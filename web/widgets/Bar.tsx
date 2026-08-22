import React from 'react'
import { Plot, type SeriesData } from './Plot'
export function Bar({ data }: { data: unknown }) { return <Plot data={data as SeriesData} mark="bar" /> }
