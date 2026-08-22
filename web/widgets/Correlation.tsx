export function Correlation({ data }: { data: unknown }) { return <pre className="correlation" aria-label="Correlation matrix">{JSON.stringify(data ?? [], null, 2)}</pre> }
