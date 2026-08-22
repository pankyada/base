export function Box({ data }: { data: unknown }) { return <pre className="boxplot" aria-label="Box plot">{JSON.stringify(data ?? [], null, 2)}</pre> }
