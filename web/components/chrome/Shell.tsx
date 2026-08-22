import type { ReactNode } from 'react'

export function Shell({ children }: { children: ReactNode }) {
  return <div className="route-shell"><nav><a href="/">analyst</a><a href="/ops">ops</a><a href="/home">assistant</a></nav>{children}</div>
}
