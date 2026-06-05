'use client'
import { useState } from 'react'

interface Props {
  tool: { type: string; arg: string; out: string; done: boolean }
  running: boolean
}

export function ToolCall({ tool, running }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div
        className={`tool-row${running ? ' tool-row--running' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span className="tool-row__name">{tool.type}</span>
        <span className="tool-row__arg">{tool.arg}</span>
        <span className="tool-row__check">{tool.done ? '✓' : '…'}</span>
        <span className="tool-row__caret">{open ? '▾' : '▸'}</span>
      </div>
      {open && tool.out && (
        <pre className="tool-output">{tool.out}</pre>
      )}
    </div>
  )
}
