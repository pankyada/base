export function FileTree({ data }: { data: unknown }) { return <pre className="file-tree" aria-label="File tree">{JSON.stringify(data ?? [], null, 2)}</pre> }
