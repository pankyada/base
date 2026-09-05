export function DocView({ data }: { data: unknown }) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return <article className="doc-view">{text ?? ''}</article>
}
