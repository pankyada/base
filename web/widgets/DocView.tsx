export function DocView({ data }: { data: unknown }) { return <article className="doc-view">{String(data ?? '')}</article> }
