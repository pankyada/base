import { useState } from 'react'
import type { ExecutionResult } from '../../lib/types'

export function fileMime(name: string): string | null {
  const extension = name.toLowerCase().split('.').pop()
  return extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'gif' ? 'image/gif' : extension === 'webp' ? 'image/webp' : null
}

export function truncateOutput(text: string, limit = 4000): { text: string; truncated: boolean } { return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false } }

export function NotebookCell({ result, code, onRerun, onEdit }: { result: ExecutionResult; code?: string; onRerun?: () => void; onEdit?: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const stdout = truncateOutput(result.stdout)
  const stderr = truncateOutput(result.stderr)
  const expanded = result.exit_code !== 0 || Boolean(result.stderr)
  return <details className={`notebook-cell ${result.exit_code !== 0 ? 'notebook-cell--error' : ''}`} open={expanded}>
    <summary>cell · {result.duration_ms}ms · {result.exit_code === 0 ? 'ok' : 'error'}</summary>
    {code ? <pre>{code}</pre> : null}
    {result.stdout ? <pre>{showAll ? result.stdout : stdout.text}{stdout.truncated && !showAll ? <button onClick={() => setShowAll(true)}>show all</button> : null}</pre> : null}
    {result.stderr ? <pre className="notebook-cell__stderr">{showAll ? result.stderr : stderr.text}</pre> : null}
    <div className="notebook-cell__files">{Object.entries(result.files).map(([name, content]) => { const mime = fileMime(name); return mime ? <img key={name} src={`data:${mime};base64,${content}`} alt={name} /> : <a key={name} download={name} href={`data:application/octet-stream;base64,${content}`}>{name}</a> })}</div>
    <div><button onClick={onRerun}>re-run</button>{onEdit ? <button onClick={onEdit}>edit-and-run</button> : null}</div>
  </details>
}
