export function Heatmap({ data }: { data: unknown }) { return <pre className="heatmap" aria-label="Heatmap">{JSON.stringify(data ?? [], null, 2)}</pre> }
