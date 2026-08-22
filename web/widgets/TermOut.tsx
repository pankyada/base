export function TermOut({ data }: { data: unknown }) { return <pre className="term-out" aria-label="Terminal output">{String(data ?? '')}</pre> }
