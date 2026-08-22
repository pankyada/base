export function DiffView({ data }: { data: unknown }) { return <pre className="diff-view" aria-label="Diff">{typeof data === 'string' ? data : JSON.stringify(data ?? '', null, 2)}</pre> }
