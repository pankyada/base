import type { ReactNode } from 'react'
import Link from 'next/link'

export function Shell({ children }: { children: ReactNode }) {
  return <div className="route-shell"><nav><Link href="/">analyst</Link><Link href="/ops">ops</Link><Link href="/town">town</Link><Link href="/home">assistant</Link></nav>{children}</div>
}
